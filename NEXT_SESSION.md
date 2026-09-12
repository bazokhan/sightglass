# Next session

The product is scope-complete for today. The next session should focus on distribution and presentation, in this order:

1. **Publish every SDK to npm**
   - Establish a proper synchronized versioning and release flow for all `@sightglass/*` SDK packages.
   - Automate trusted npm publishing from GitHub Actions.
   - Publish the initial SDK release and verify installation from a clean external project.

2. **Publish the server to Docker Hub**
   - Establish automated, versioned multi-platform image publishing from GitHub Actions.
   - Publish immutable version tags plus the appropriate moving tag.
   - Verify that a user can run the published image with one documented command and a persistent volume.

3. **Extract documentation into a public website package**
   - Move the consumer documentation out of the authenticated/private dashboard experience into its own workspace package.
   - Preserve a single source of truth for guides, API details, benchmarks, comparison data, and operations documentation.
   - Make the package independently buildable and deployable as the public Sightglass documentation website.

4. **Revamp the dashboard UI**
   - Redesign the dashboard into a cleaner, more modern product interface inspired by Vercel and comparable contemporary developer tools.
   - Preserve all existing functionality, filtering, accessibility, responsive behavior, and information density.
   - Treat this as a visual and interaction-system redesign, not a feature expansion.

