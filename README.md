# PROS Depot

A GitHub Action that generates a PROS depot JSON file from GitHub releases for
PROS template distribution. This action helps maintain a catalog of PROS
templates by scanning releases and creating a structured JSON file that can be
used by PROS-CLI.

## Features

- Scans GitHub releases for PROS template zip files
- Generates a structured depot JSON file compatible with PROS-CLI
- Supports filtering releases (all/stable-only/prerelease-only)
- Caches previously processed templates for efficiency
- Automatically commits and pushes updates to a target branch

## Usage

Add the following step to your GitHub Actions workflow:

```yml
- name: Generate PROS depot
  uses: jerrylum/pros-depot@v1.0.0
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
```

For a complete workflow that updates the depot whenever a new release is
published:

```yml
name: Populate Depot JSON

on:
  # runs when this repository's releases are modified
  release:
  # allows for manual dispatching of the workflow
  workflow_dispatch:

jobs:
  populate:
    runs-on: ubuntu-latest
    permissions:
      # permits reading of releases and writing to the depot branch
      contents: write
    steps:
      - uses: jerrylum/pros-depot@v1.0.0
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```

When the action is run, it will generate a depot JSON file named `depot.json`
in branch `depot`. If the branch does not exist, it will be created with just
the depot JSON file.

## Inputs

| Input                 | Description                                                                       | Required | Default               |
| --------------------- | --------------------------------------------------------------------------------- | -------- | --------------------- |
| `token`               | GitHub token for accessing repository releases                                    | No       | `${{ github.token }}` |
| `include_prereleases` | Include prereleases in the depot (all/stable-only/prerelease-only)                | No       | `all`                 |
| `commit_message`      | Commit message for the depot JSON file. Use %MESSAGE% to insert generated message | No       | `%MESSAGE%`           |
| `push`                | Push the generated depot JSON file to the target branch                           | No       | `true`                |
| `target_repo`         | Target repository to push the depot JSON file to                                  | No       | Current repository    |
| `target_branch`       | Branch to store the generated depot JSON file                                     | No       | `depot`               |
| `target_path`         | Path where the JSON file will be stored in the target branch                      | No       | `depot.json`          |

### `include_prereleases`

- `all` - Include all releases
- `stable-only` - Include only stable releases
- `prerelease-only` - Include only prereleases

### `commit_message`

Use `%MESSAGE%` to insert the generated message. For example, if you want to
include gitmoji in the commit message, you can use `:tada: %MESSAGE%`.

## `push`

If `push` is set to `false`, the action will not push the generated depot JSON
file to the target branch. This is useful if you want to manually push the file
to the target branch later, or if you want to customize the commit message.

## Outputs

| Output | Description                                  |
| ------ | -------------------------------------------- |
| depot  | The content of the generated depot JSON file |

## Example Depot JSON

```json
[
  {
    "metadata": {
      "location": "https://github.com/user/repo/releases/download/v1.0.0/template.zip"
    },
    "name": "Example Template",
    "py/object": "pros.conductor.templates.base_template.BaseTemplate",
    "supported_kernels": "^3.8.0",
    "target": "v5",
    "version": "1.0.0"
  }
]
```

## Permissions

The action requires the following permissions:

- contents: write - To push the generated depot file to the target branch

Add these permissions to your workflow:

```yml
permissions:
  contents: write
```

## How It Works

The PROS Depot action processes GitHub releases and generates a depot file
through the following steps:

1. **Fetch Current Depot**

   - Attempts to fetch the existing depot file from the target branch
   - If found, parses the depot file

2. **Fetch Releases**

   - Fetches all releases from the source repository
   - Filters releases based on the `include_prereleases` setting:
     - `all`: Includes both stable and pre-releases
     - `stable-only`: Only includes stable releases
     - `prerelease-only`: Only includes pre-releases

3. **Fetch Templates**

   - For each release, scans through assets to find ZIP files
   - Checks if each ZIP has been updated since the last depot update
   - If a ZIP hasn't changed and was previously processed:
     - Reuses the existing template information from the current depot
     - Skips downloading and processing that ZIP
   - If a ZIP is new or has been updated:
     - Marks it for processing
   - Otherwise, skips the ZIP

4. **Process Templates**

   - For each new or updated ZIP file:
     - Downloads the ZIP content
     - Extracts and reads the `template.pros` file
     - Validates the template structure
     - Converts the external template format to the base template format
     - Adds the template to the new depot list

5. **Generate Depot**

   - Combines all processed templates into a JSON array
   - Formats the JSON with proper indentation

6. **File Update**

   - Generates a commit message based on changes:
     - For single new template: "Release version X.Y.Z"
     - For multiple changes: "Update one or more version(s)"
   - If pushing is enabled (`push: true`):
     - Checks if the target branch exists
     - If branch doesn't exist, creates a new orphan branch
     - Commits and pushes the updated depot file

## Advanced Usage

### Custom Target Repository

To push the depot file to a different repository:

```yml
- name: Generate PROS depot
  uses: jerrylum/pros-depot@v1.0.0
  with:
    token: ${{ secrets.PAT_TOKEN }} # Need a PAT with repo access
    target_repo: organization/my-library-website
    target_branch: main
    target_path: depot.json
```

This is useful if you want to push the depot file to a different repository, for
example, a separated repository for your PROS library website. If you also set
up GitHub Pages for your library website, your users can then download the depot
file via links like `https://my-library-website.com/depot.json`.

### Custom Commit Messages

To customize the commit message:

```yml
- name: Generate PROS depot
  uses: jerrylum/pros-depot@v1.0.0
  with:
    commit_message: 'chore: %MESSAGE%' # Will insert the generated message
```
