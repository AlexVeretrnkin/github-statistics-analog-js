import type { CodegenConfig } from '@graphql-codegen/cli';
import { getGitHubConfig } from './src/config/github';

const { graphqlEndpoint, schemaPath, token } = getGitHubConfig();

if (!schemaPath && !token) {
  throw new Error(
    'Set GITHUB_TOKEN or GITHUB_GRAPHQL_SCHEMA_PATH before running GraphQL code generation.',
  );
}

const config: CodegenConfig = {
  overwrite: true,
  schema: schemaPath
    ? schemaPath
    : [
        {
          [graphqlEndpoint]: {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        },
      ],
  documents: [
    'src/graphql/**/*.{graphql,ts}',
    '!src/graphql/generated/**/*',
  ],
  generates: {
    'src/graphql/generated/': {
      preset: 'client',
      config: {
        defaultScalarType: 'string',
      },
    },
    './schema.graphql': {
      plugins: ['schema-ast'],
      config: {
        includeDirectives: true,
      },
    },
  },
  ignoreNoDocuments: false,
};

export default config;
