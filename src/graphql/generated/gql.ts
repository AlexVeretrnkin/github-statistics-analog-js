/* eslint-disable */
import * as types from './graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  query RepositoryIssues(\n    $owner: String!\n    $repo: String!\n    $monthlyIssuesQuery: String!\n    $monthlyOpenIssuesQuery: String!\n    $monthlyClosedIssuesQuery: String!\n  ) {\n    repository(owner: $owner, name: $repo) {\n      id\n      name\n      owner {\n        login\n      }\n    }\n    monthlyIssues: search(query: $monthlyIssuesQuery, type: ISSUE) {\n      issueCount\n    }\n    monthlyOpenIssues: search(query: $monthlyOpenIssuesQuery, type: ISSUE) {\n      issueCount\n    }\n    monthlyClosedIssues: search(query: $monthlyClosedIssuesQuery, type: ISSUE) {\n      issueCount\n    }\n  }\n": typeof types.RepositoryIssuesDocument,
    "\n  query RepositoryLabels(\n    $owner: String!\n    $repo: String!\n    $first: Int = 100\n    $after: String\n  ) {\n    repository(owner: $owner, name: $repo) {\n      id\n      name\n      owner {\n        login\n      }\n      labels(first: $first, after: $after) {\n        totalCount\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        nodes {\n          id\n          name\n          color\n          description\n        }\n      }\n    }\n  }\n": typeof types.RepositoryLabelsDocument,
};
const documents: Documents = {
    "\n  query RepositoryIssues(\n    $owner: String!\n    $repo: String!\n    $monthlyIssuesQuery: String!\n    $monthlyOpenIssuesQuery: String!\n    $monthlyClosedIssuesQuery: String!\n  ) {\n    repository(owner: $owner, name: $repo) {\n      id\n      name\n      owner {\n        login\n      }\n    }\n    monthlyIssues: search(query: $monthlyIssuesQuery, type: ISSUE) {\n      issueCount\n    }\n    monthlyOpenIssues: search(query: $monthlyOpenIssuesQuery, type: ISSUE) {\n      issueCount\n    }\n    monthlyClosedIssues: search(query: $monthlyClosedIssuesQuery, type: ISSUE) {\n      issueCount\n    }\n  }\n": types.RepositoryIssuesDocument,
    "\n  query RepositoryLabels(\n    $owner: String!\n    $repo: String!\n    $first: Int = 100\n    $after: String\n  ) {\n    repository(owner: $owner, name: $repo) {\n      id\n      name\n      owner {\n        login\n      }\n      labels(first: $first, after: $after) {\n        totalCount\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        nodes {\n          id\n          name\n          color\n          description\n        }\n      }\n    }\n  }\n": types.RepositoryLabelsDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query RepositoryIssues(\n    $owner: String!\n    $repo: String!\n    $monthlyIssuesQuery: String!\n    $monthlyOpenIssuesQuery: String!\n    $monthlyClosedIssuesQuery: String!\n  ) {\n    repository(owner: $owner, name: $repo) {\n      id\n      name\n      owner {\n        login\n      }\n    }\n    monthlyIssues: search(query: $monthlyIssuesQuery, type: ISSUE) {\n      issueCount\n    }\n    monthlyOpenIssues: search(query: $monthlyOpenIssuesQuery, type: ISSUE) {\n      issueCount\n    }\n    monthlyClosedIssues: search(query: $monthlyClosedIssuesQuery, type: ISSUE) {\n      issueCount\n    }\n  }\n"): (typeof documents)["\n  query RepositoryIssues(\n    $owner: String!\n    $repo: String!\n    $monthlyIssuesQuery: String!\n    $monthlyOpenIssuesQuery: String!\n    $monthlyClosedIssuesQuery: String!\n  ) {\n    repository(owner: $owner, name: $repo) {\n      id\n      name\n      owner {\n        login\n      }\n    }\n    monthlyIssues: search(query: $monthlyIssuesQuery, type: ISSUE) {\n      issueCount\n    }\n    monthlyOpenIssues: search(query: $monthlyOpenIssuesQuery, type: ISSUE) {\n      issueCount\n    }\n    monthlyClosedIssues: search(query: $monthlyClosedIssuesQuery, type: ISSUE) {\n      issueCount\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query RepositoryLabels(\n    $owner: String!\n    $repo: String!\n    $first: Int = 100\n    $after: String\n  ) {\n    repository(owner: $owner, name: $repo) {\n      id\n      name\n      owner {\n        login\n      }\n      labels(first: $first, after: $after) {\n        totalCount\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        nodes {\n          id\n          name\n          color\n          description\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  query RepositoryLabels(\n    $owner: String!\n    $repo: String!\n    $first: Int = 100\n    $after: String\n  ) {\n    repository(owner: $owner, name: $repo) {\n      id\n      name\n      owner {\n        login\n      }\n      labels(first: $first, after: $after) {\n        totalCount\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        nodes {\n          id\n          name\n          color\n          description\n        }\n      }\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;