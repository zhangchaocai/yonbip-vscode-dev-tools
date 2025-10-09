//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');

/**@type {import('webpack').Configuration}*/
const config = {
  target: 'node', // vscode插件运行在Node.js环境中

  entry: './src/extension.ts', // 插件的入口文件
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode', // vscode模块由vscode本身提供，不需要打包
    // 排除这些模块，因为它们在VSCode运行时环境中不可用或不必要
    'pg-native': 'commonjs pg-native',
    'mssql': 'commonjs mssql',
    'mysql2': 'commonjs mysql2',
    'oracledb': 'commonjs oracledb',
    'tedious': 'commonjs tedious'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  }
};

module.exports = config;