'use strict';

const {writeFile, readFile, mkdir, rm} = require('node:fs/promises');
const {expect} = require('chai');
const sinon = require('sinon');
const rewire = require('rewire');


describe('deployer', () => {
  describe('dry-run', () => {
    let hexo, args;

    const argsDefault = {host: 'example.com', user: 'user', root: '/rootDir'};

    const deployer = rewire('../lib/deployer');
    let fakeHexoSpawn = sinon.fake.resolves();
    deployer.__set__('spawn', fakeHexoSpawn);

    beforeEach(() => {
      hexo = {
        public_dir: '/public', log: {
          info: sinon.stub(), fatal: sinon.stub()
        }
      };
      args = {...argsDefault};

      fakeHexoSpawn = sinon.fake.resolves();
      deployer.__set__('spawn', fakeHexoSpawn);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should display help message if required args are missing', () => {
      args = {};
      const consoleStub = sinon.stub(console, 'log');

      const result = deployer.call(hexo, args);

      expect(result).to.be.undefined;
      expect(consoleStub.callCount).to.be.equal(1);
      expect(consoleStub.args[0][0]).to.contain('You should configure deployment settings in _config.yml first!');

      expect(fakeHexoSpawn.callCount).to.be.equal(0);

      consoleStub.restore();
    });

    it('should set default values for optional args', () => {
      args = {...args};

      return deployer.call(hexo, args).then(() => {
        expect(args.delete).to.be.true;
        expect(args.verbose).to.be.true;
        expect(args.progress).to.be.true;
        expect(args.ignore_errors).to.be.false;
        expect(args.create_before_update).to.be.false;

        const spawnArgs = fakeHexoSpawn.args[0][1];
        expect(fakeHexoSpawn.callCount).to.be.equal(1);
        expect(fakeHexoSpawn.args[0][0]).to.equal('rsync');
        expect(fakeHexoSpawn.args[0][2]).to.eql({verbose: true});

        expect(spawnArgs).to.include('--delete');
        expect(spawnArgs).to.include('-v');
        expect(spawnArgs).to.include('-az');
        expect(spawnArgs).to.include(hexo.public_dir);
        expect(spawnArgs).to.include(`${args.user}@${args.host}:${args.root}`);
      });
    });

    it('should add port to params if provided', () => {
      args = {...args, port: 11451};

      return deployer.call(hexo, args).finally(() => {
        const spawnArgs = fakeHexoSpawn.args[0][1];

        expect(fakeHexoSpawn.callCount).to.be.equal(1);
        expect(spawnArgs).to.include(`ssh -p ${args.port}`);
      });
    });

    it('should handle invalid port number', () => {
      args = {...args, port: 99999};

      return deployer.call(hexo, args).finally(() => {
        const spawnArgs = fakeHexoSpawn.args[0][1];

        expect(fakeHexoSpawn.callCount).to.be.equal(1);
        expect(spawnArgs.join()).to.not.include(' -p ');
      });
    });

    it('should add port and key to params if provided', () => {
      args = {...args, port: 2222, key: _testDir + 'key'};

      return deployer.call(hexo, args).finally(() => {
        const spawnArgs = fakeHexoSpawn.args[0][1];

        expect(fakeHexoSpawn.callCount).to.be.equal(1);
        expect(spawnArgs).to.include(`ssh -i ${args.key} -p ${args.port}`);
      });
    });

    it('should add port and rsh to params if provided', () => {
      args = {...args, port: 2222, rsh: 'mosh'};

      return deployer.call(hexo, args).finally(() => {
        const spawnArgs = fakeHexoSpawn.args[0][1];

        expect(fakeHexoSpawn.callCount).to.be.equal(1);
        expect(spawnArgs).to.include(`'${args.rsh}' -p ${args.port}`);
      });
    });
    it('should add port and rsh and key to params if provided', () => {
      args = {...args, port: 2222, rsh: 'mosh', key: _testDir + 'key'};

      return deployer.call(hexo, args).finally(() => {
        const spawnArgs = fakeHexoSpawn.args[0][1];

        expect(fakeHexoSpawn.callCount).to.be.equal(1);
        expect(spawnArgs).to.include(`'${args.rsh}' -i ${args.key} -p ${args.port}`);
      });
    });

    it.skip('should handle create_before_update correctly', async () => {
      args = {...args, create_before_update: true};

      return deployer.call(hexo, args).finally(() => {
        const spawnArgs1 = fakeHexoSpawn.getCall(0).args[1];
        const spawnArgs2 = fakeHexoSpawn.getCall(1).args[1];

        expect(fakeHexoSpawn.callCount).to.equal(2);
        expect(spawnArgs1).to.include('--ignore-existing');
        expect(spawnArgs2).to.not.include('--ignore-existing');
      });
    });

    it('check sinon work properly', () => {
      expect(fakeHexoSpawn.callCount).to.be.equal(0);
    });
  });

  describe.only('daemon', () => {
    let hexo, args;

    const rsyncdConfig = 'test/rsyncd.test.conf';
    const rsyncdSecret = 'test/rsyncd.test.secret';
    const _testDir = 'tmp/_test/';
    const module1Dir = _testDir + 'module1/';
    const module2Dir = _testDir + 'module2/';
    const passwordFile1 = _testDir + 'user1';
    const passwordFile2 = _testDir + 'user2';
    const rsyncdPidFile = _testDir + "rsyncd.test.pid"

    const args1Default = {host: 'localhost', user: 'user1', root: ':module1/'};
    const args2Default = {host: 'localhost', user: 'user2', root: ':module2/'};

    const deployer = require('../lib/deployer');
    const {exec, spawn} = require('node:child_process');

    before(() => {
      const users = {'user1': "password1", 'user2': 'password1'};
      const startRsyncd = () => {
        return new Promise((resolve, reject) => {
          const child = spawn('rsync', ['--daemon', '--config', rsyncdConfig], {
            detached: true,
            stdio: 'ignore',
          });
          child.unref()
          child.on('close', resolve);
          child.on('exit', resolve);
          child.on('error', reject);
        }).then(((exitCode, signal) => {
          if (exitCode !== 0) {
            throw new Error(`childProcess: Failed to start rsyncd daemon, exit code: ${exitCode}. ${signal}`)
          }
        }))
      }

      return Promise.all([mkdir(module1Dir, {recursive: true}), mkdir(module2Dir, {recursive: true})]).then(() => {
        return Promise.all([writeFile(passwordFile1, users['user1']), writeFile(passwordFile2, users['user2'])]).then(() => {
          return Promise.all([spawn('chmod', ['600', passwordFile1]), spawn('chmod', ['600', passwordFile2]), spawn('chmod', ['600', rsyncdSecret])]).then(async () => {
            return Promise.all([startRsyncd()])
          })
        });
      });
    });

    after(() => {
      const killRsyncd = () => {
        return readFile(rsyncdPidFile).then((id) => {
          return spawn('kill', ['-9', id.toString().trim()])
        }).then((res) => {
          return rm(rsyncdPidFile)
        });
      }

      return killRsyncd().then(() => {
        // rm(_testDir, {recursive: true})
      })
    });

    beforeEach(() => {
      hexo = {
        public_dir: 'test'
      };

    });

    afterEach(() => {
    });

    it('check daemon running', (done) => {
      exec('ps aux | grep rsyncd | grep -v grep', (err, stdout, stderr) => {
        if (err || stderr) {
          done(err || stderr);
        }

        expect(stdout).to.include(`rsync --daemon --config ${rsyncdConfig}`);
        done();
      });
    })

    it("push file to module1", () => {
      args = {...args1Default, args: "--port=11451 --password-file=" + passwordFile1};

      return deployer.call(hexo, args).then(() => {
        expect(true).to.be.true;
      })
    })
  })
});
