const test = require('tape');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

const consulStub = sinon.stub();
const vault2kmsStub = sinon.stub();
const kmsConfigStub = sinon.stub();

const ServerlessServiceConfig = proxyquire('./index', {
  './consul': { get: consulStub },
  './vault2kms': { retrieveAndEncrypt: vault2kmsStub },
  './kms_config': { load: kmsConfigStub }
});

test('serviceConfig', (t) => {
  t.test('should call consul to get config', async (assert) => {
    assert.plan(1);

    consulStub.reset();

    consulStub
      .withArgs('http://consul/v1/kv/prefix/config_path/key')
      .resolves('a sample value');

    const service = new ServerlessServiceConfig({
      service: {
        custom: {
          service_config_plugin: {
            consulAddr: 'http://consul',
            consulPrefix: 'prefix'
          }
        }
      }
    });

    const value = await service.getServiceConfig('serviceConfig:config_path/key');

    assert.equal(value, 'a sample value');
  });
});

test('secretConfig', (t) => {
  t.test('should get value from consul and vault and encrypt with kms', async (assert) => {
    assert.plan(1);

    const fakeKms = {};
    const kmsKeyId = {
      stage: 'kmsKeyId'
    };
    const slsConfig = {
      service: {
        provider: {
          stage: 'stage'
        },
        custom: {
          service_config_plugin: {
            consulAddr: 'http://consul',
            vaultAddr: 'http://vault_server',
            kmsKeyId,
          }
        }
      }
    };

    vault2kmsStub.reset();
    vault2kmsStub
      .withArgs('http://consul/v1/kv/vault/my_secret/secret', 'http://vault_server/v1/', fakeKms, 'kmsKeyId')
      .resolves('a base64 encrypted secret');

    kmsConfigStub.reset();
    kmsConfigStub
      .withArgs(slsConfig)
      .returns(fakeKms);

    const service = new ServerlessServiceConfig(slsConfig);

    const value = await service.getSecretConfig('secretConfig:vault/my_secret/secret');

    assert.equal(value, 'a base64 encrypted secret');
  });

  t.test('should fail if kms key id definition is missing', async (assert) => {
    assert.plan(1);

    const service = new ServerlessServiceConfig({
      service: {
        provider: {
          stage: 'dev'
        },
        custom: {
          service_config_plugin: {}
        }
      }
    });

    try {
      await service.getSecretConfig('secretConfig:vault/my_secret/secret');
    } catch (e) {
      assert.equal(e.message, 'KMS Key Id missing, please specify it in in the plugin config [service_config_plugin.kmsKeyId.dev]');
    }
  });

  t.test('should fail if kms key id for stage is missing', async (assert) => {
    assert.plan(1);

    const service = new ServerlessServiceConfig({
      service: {
        provider: {
          stage: 'green'
        },
        custom: {
          service_config_plugin: {
            kmsKeyId: {
              blue: 'myKey'
            }
          }
        }
      }
    });

    try {
      await service.getSecretConfig('secretConfig:vault/my_secret/secret');
    } catch (e) {
      assert.equal(e.message, 'KMS Key Id missing, please specify it in in the plugin config [service_config_plugin.kmsKeyId.green]');
    }
  });
});