#!/usr/bin/env bash
set -euo pipefail

die() { printf '%s\n' "$*" >&2; exit 1; }

[[ $# -ge 2 ]] || die 'usage: fetch-workflows.sh <owner> <out-dir> [repo...]'
owner=$1
out=$2
shift 2
[[ $owner =~ ^[A-Za-z0-9][A-Za-z0-9-]*$ ]] || die "invalid owner: $owner"
if [[ -e $out ]]; then
  [[ -d $out ]] || die "not a directory: $out"
  [[ -z $(ls -A -- "$out") ]] || die "refusing non-empty out-dir: $out"
fi
command -v gh >/dev/null || die 'gh is required'

if [[ $# -eq 0 ]]; then
  query='query($owner: String!, $endCursor: String) {
    repositoryOwner(login: $owner) {
      repositories(first: 100, after: $endCursor, isArchived: false) {
        nodes { name }
        pageInfo { hasNextPage endCursor }
      }
    }
  }'
  repos=$(gh api graphql --paginate -f query="$query" -F owner="$owner" \
    --jq '.data.repositoryOwner.repositories.nodes[].name')
  set --
  while IFS= read -r repo; do
    [[ -z $repo ]] || set -- "$@" "$repo"
  done <<< "$repos"
fi
for repo in "$@"; do
  [[ $repo =~ ^[A-Za-z0-9_.-]+$ && $repo != . && $repo != .. ]] || die "invalid repository: $repo"
done

mkdir -p -- "$out"
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
for repo in "$@"; do
  archived=$(gh api "repos/$owner/$repo" --jq '.archived')
  [[ $archived == false ]] || continue
  if ! gh api "repos/$owner/$repo/contents/.github/workflows" \
    --jq '.[] | select(.type == "file" and (.name | test("\\.(yml|yaml)$"))) | if (.name | test("[\r\n]")) then error("unsupported workflow filename") else .name, (.name | @uri) end' \
    > "$scratch/files" 2> "$scratch/error"; then
    if ! grep -q 'HTTP 404' "$scratch/error"; then
      cat "$scratch/error" >&2
      exit 1
    fi
    continue
  fi
  while IFS= read -r file; do
    [[ -n $file ]] || continue
    # The listing pairs each name with its URL-encoded path component.
    IFS= read -r encoded
    mkdir -p -- "$out/$repo"
    gh api "repos/$owner/$repo/contents/.github/workflows/$encoded" \
      -H 'Accept: application/vnd.github.raw+json' > "$out/$repo/$file"
  done < "$scratch/files"
done
