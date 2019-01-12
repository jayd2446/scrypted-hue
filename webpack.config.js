const defaultWebpackConfig = require('scrypted-deploy').getDefaultWebpackConfig();
const merge = require('webpack-merge');
const path = require('path');

const webpackConfig = {
    resolve: {
        alias: {
            dgram: path.resolve(__dirname, 'src/dgram'),
        }
    },
}

module.exports = merge(defaultWebpackConfig, webpackConfig);
