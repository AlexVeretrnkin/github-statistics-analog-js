import { graphql } from '../generated';

export const repositoryLabelsDocument = graphql(/* GraphQL */ `
  query RepositoryLabels(
    $owner: String!
    $repo: String!
    $first: Int = 100
    $after: String
  ) {
    repository(owner: $owner, name: $repo) {
      id
      name
      owner {
        login
      }
      labels(first: $first, after: $after) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          name
          color
          description
        }
      }
    }
  }
`);
