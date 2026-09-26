# Website delivery

Read the repository's Markdown documentation before changing the site. Keep its size goals, measurement boundaries and dated evidence accurate.

Finished user-requested website changes must be committed, pushed to GitHub and deployed to Alfred. From the repository root, run `npm run deploy -- alfred-lan`, then `npm run build`, `npm run verify:live` and `npm run verify:alias`. Confirm the live responses match the finished source before reporting completion.

The page deploy does not update the server image, host scripts or Unraid template. Deploy changes to those separately, retain the previous image and configuration for rollback, and verify the active service. Follow [the hosting guide](server/README.md).

Update the relevant documentation and deployment evidence after verification. Preserve historical measurements; do not present local benchmarks as live-site results. This workflow applies to the requested website work, not unrelated changes, and does not call for a recurring automation.
