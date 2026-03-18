import { graphql } from '../generated';

export const repositoryIssuesDocument = graphql(/* GraphQL */ `
  query RepositoryIssues(
    $owner: String!
    $repo: String!
    $monthlyIssuesQuery: String!
    $monthlyOpenIssuesQuery: String!
    $monthlyClosedIssuesQuery: String!
  ) {
    repository(owner: $owner, name: $repo) {
      id
      name
      owner {
        login
      }
    }
    monthlyIssues: search(query: $monthlyIssuesQuery, type: ISSUE) {
      issueCount
    }
    monthlyOpenIssues: search(query: $monthlyOpenIssuesQuery, type: ISSUE) {
      issueCount
    }
    monthlyClosedIssues: search(query: $monthlyClosedIssuesQuery, type: ISSUE) {
      issueCount
    }
  }
`);
