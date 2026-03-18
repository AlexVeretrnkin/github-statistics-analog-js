export interface GitHubConfig {
  graphqlEndpoint: string;
  token?: string;
  schemaPath?: string;
}

const trimEnv = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const getGitHubConfig = (): GitHubConfig => ({
  graphqlEndpoint: 'https://api.github.com/graphql',
  token: trimEnv(process.env['GITHUB_TOKEN']),
  schemaPath: trimEnv(process.env['GITHUB_GRAPHQL_SCHEMA_PATH']),
});

export const getRequiredGitHubToken = (): string => {
  const { token } = getGitHubConfig();

  if (!token) {
    throw new Error('Missing GITHUB_TOKEN environment variable.');
  }

  return token;
};
