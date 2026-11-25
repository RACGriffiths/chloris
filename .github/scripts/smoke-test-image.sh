#!/usr/bin/env bash
# Starts a Chloris image and checks that it works: its health check passes, and its About page
# links to the commit it was built from (D59) and, when a version is given, shows it. image.yml runs
# it on pull requests, and release.yml on each platform's image before anything is published.
#
# Usage: smoke-test-image.sh <image> <commit> [<version>]
set -euo pipefail

image=$1
commit=$2
version=${3:-}
container=chloris-smoke-test

docker run -d --name "$container" \
	-e ORIGIN=http://localhost:3000 \
	-e BETTER_AUTH_SECRET=ci-smoke-test-only-not-a-real-secret \
	"$image" >/dev/null
trap 'docker rm -f "$container" >/dev/null' EXIT

# The image's own HEALTHCHECK asks /api/health whether the database is answering.
for attempt in $(seq 1 30); do
	read -r state health <<<"$(docker inspect --format '{{.State.Status}} {{.State.Health.Status}}' "$container")"
	if [ "$health" = healthy ]; then
		echo "The container is healthy."
		break
	fi
	if [ "$state" != running ] || [ "$health" = unhealthy ] || [ "$attempt" = 30 ]; then
		echo "::error::The container did not become healthy (state: $state, health: $health)."
		docker logs "$container"
		exit 1
	fi
	sleep 2
done

about=$(docker exec "$container" node -e "
	fetch('http://127.0.0.1:3000/about')
		.then((response) => response.text())
		.then((page) => process.stdout.write(page))
")
if [[ $about != *"/tree/$commit"* ]]; then
	echo "::error::The About page doesn't link to the source of $commit."
	exit 1
fi
echo "The About page links to the source of $commit."
if [ -n "$version" ]; then
	if [[ $about != *">$version<"* ]]; then
		echo "::error::The About page doesn't show version $version."
		exit 1
	fi
	echo "The About page shows version $version."
fi
