const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// In monorepos, prioritize this app's node_modules first, while keeping
// Expo default lookup paths so internal runtime helpers remain resolvable.
const appNodeModules = path.resolve(__dirname, 'node_modules');
const workspaceNodeModules = path.resolve(__dirname, '../../node_modules');

config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [
	appNodeModules,
	workspaceNodeModules,
	...config.resolver.nodeModulesPaths.filter(
		(entry) => entry !== appNodeModules && entry !== workspaceNodeModules
	)
];

config.resolver.extraNodeModules = {
	react: path.join(appNodeModules, 'react'),
	'react-native': path.join(appNodeModules, 'react-native')
};

module.exports = config;
