const consul = require('./consul');
const vault2kms = require('./vault2kms');
const pluginConfig = require('./plugin_config');
const kmsConfig = require('./kms_config');

class ServerlessServiceConfig {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.variableResolvers = {
      serviceConfig: this.getServiceConfig.bind(this),
      secretConfig: this.getSecretConfig.bind(this),
    };
  }

  // the serverless framework will always invoke this
  // function with param starting with 'serviceConfig:'
  async getServiceConfig(param = 'serviceConfig:') {
    const path = param.slice('serviceConfig:'.length);

    const { service_config_plugin } = this.serverless.service.custom;

    const config = pluginConfig.load(service_config_plugin);

    return consul.get(`${config.consulUrl()}${path}`);
  }

  // the serverless framework will always invoke this
  // function with param starting with 'secretConfig:'
  async getSecretConfig(param = 'secretConfig:') {
    const path = param.slice('secretConfig:'.length);

    const { service_config_plugin } = this.serverless.service.custom;
    const { stage } = this.serverless.service.provider;

    const config = pluginConfig.load(service_config_plugin);

    const { kmsKeyId = {}, kmsKeyConsulPath } = config;

    let kmsKeyIdValue;
    if (kmsKeyConsulPath && typeof kmsKeyConsulPath === 'string') {
      kmsKeyIdValue = await this.getServiceConfig(`serviceConfig:${kmsKeyConsulPath}`);
    } else if (kmsKeyId[stage]) {
      kmsKeyIdValue = kmsKeyId[stage];
    } else {
      throw new Error(`KMS Key Id missing, please specify it in in the plugin config with either:\nservice_config_plugin.kmsKeyConsulPath = path/to/key\n[DEPRECATED] service_config_plugin.kmsKeyId.${stage} = keyId`);
    }
    return vault2kms.retrieveAndEncrypt(`${config.consulUrl()}${path}`, config.vaultUrl(), kmsConfig.load(this.serverless), kmsKeyIdValue);
  }
}

module.exports = ServerlessServiceConfig;
