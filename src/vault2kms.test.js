const test = require('tape');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const { KMS } = require('@aws-sdk/client-kms');

const kms = new KMS();

const consulStub = sinon.stub();
const requestStub = sinon.stub();
const kmsStub = sinon.stub(kms, 'encrypt');

const vault2kms = proxyquire('./vault2kms', {
  'request-promise-native': requestStub,
  './consul': { get: consulStub }
});

test('before - fake vault token', (t) => {
  process.env.VAULT_TOKEN = 'vault_token';
  t.end();
});

test('should retrieve secret from Vault and encrypt with KMS', async (assert) => {
  assert.plan(3);

  requestStub.reset();
  kmsStub.reset();

  requestStub
    .withArgs({
      method: 'GET',
      url: 'http://vault/secret/path',
      headers: {
        'X-Vault-Token': 'vault_token'
      },
      json: true
    })
    .resolves({
      data: {
        value: 'fake_secret'
      }
    });

  kmsStub
    .onCall(0)
    .resolves({
      CiphertextBlob: Buffer.from('encrypted:fake_secret')
    });

  const encryptedSecret = await vault2kms.retrieveAndEncrypt(
    'secret/path',
    'http://vault/',
    kms,
    'kmsKeyId'
  );

  assert.equal(encryptedSecret.value, 'ZW5jcnlwdGVkOmZha2Vfc2VjcmV0');
  assert.deepEquals('kmsKeyId', kmsStub.firstCall.args[0].KeyId);
  assert.deepEquals('fake_secret', kmsStub.firstCall.args[0].Plaintext.toString('utf8'));
});

test('should throw if no data is returned from Vault', async (assert) => {
  const expectedVaultResponses = [{ data: {} }, {}, null];

  assert.plan(expectedVaultResponses.length);

  for (const response of expectedVaultResponses) {
    requestStub.reset();
    requestStub.resolves(response);

    try {
      await vault2kms.retrieveAndEncrypt('secret/path', 'http://vault/', kms, 'kmsKeyId');
    } catch (e) {
      assert.equal(e.message, 'Missing secret in Vault at secret/path');
    }
  }
});

test('should throw friendler exception when Vault returns 404', async (assert) => {
  const notFoundError = new Error('404 - not found');
  notFoundError.statusCode = 404;

  assert.plan(1);

  requestStub.reset();
  requestStub.rejects(notFoundError);

  try {
    await vault2kms.retrieveAndEncrypt('secret/path', 'http://vault/', kms, 'kmsKeyId');
  } catch (e) {
    assert.equal(e.message, 'Missing secret in Vault at secret/path');
  }
});

test('should throw if encrypted secret cannot be retrieved', async (assert) => {
  consulStub.reset();
  requestStub.reset();

  consulStub.withArgs('path/to/secret').resolves('secret/path');

  requestStub.resolves({
    data: {
      value: 'fake_secret'
    }
  });

  const expectedKmsResponses = [{ data: null }, null];

  assert.plan(expectedKmsResponses.length);

  for (const response of expectedKmsResponses) {
    kmsStub.reset();
    kmsStub.resolves(response);

    try {
      await vault2kms.retrieveAndEncrypt('path/to/secret', 'http://vault/', kms, 'kmsKeyId');
    } catch (e) {
      assert.equal(e.message, 'Missing encrypted secret value from AWS response');
    }
  }
});

test('should return fallback if defined and key not present', async (assert) => {
  assert.plan(3);
  consulStub.reset();
  consulStub.withArgs('path/to/secret').resolves('fallback');

  const notFoundError = new Error('404 - not found');
  notFoundError.statusCode = 404;

  requestStub.reset();
  requestStub.rejects(notFoundError);

  kmsStub.reset();
  kmsStub
    .onCall(0)
    .resolves({
      CiphertextBlob: Buffer.from('encrypted:fallback')
    });

  const encryptedSecret = await vault2kms.retrieveAndEncrypt(
    'path/to/secret',
    'http://vault/',
    kms,
    'kmsKeyId',
    'fallback'
  );

  assert.equal(encryptedSecret.value, 'ZW5jcnlwdGVkOmZhbGxiYWNr');
  assert.deepEquals('kmsKeyId', kmsStub.firstCall.args[0].KeyId);
  assert.deepEquals('fallback', kmsStub.firstCall.args[0].Plaintext.toString('utf8'));
});

test('after - unset fake vault token', (t) => {
  delete process.env.VAULT_TOKEN;
  t.end();
});

test('should fail if vault token not present', async (assert) => {
  assert.plan(1);

  try {
    await vault2kms.retrieveAndEncrypt('path/to/secret', 'http://vault/', kms, 'kmsKeyId');
  } catch (e) {
    assert.equal(
      e.message,
      'Missing vault token for authentication, you need to set VAULT_TOKEN as a environment variable'
    );
  }
});
