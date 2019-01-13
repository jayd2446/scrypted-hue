const defaultWebpackConfig = require('scrypted-deploy').getDefaultWebpackConfig();
const merge = require('webpack-merge');
const path = require('path');

const webpackConfig = {
    resolve: {
        alias: {
            dgram: path.resolve(__dirname, 'src/dgram'),
            q: path.resolve(__dirname, 'src/q'),
        }
    },
    externals: {
        // ignore xml2js since nupnpsearch is used instead.
        "xml2js": "xml2js"
    },
}

module.exports = merge(defaultWebpackConfig, webpackConfig);
