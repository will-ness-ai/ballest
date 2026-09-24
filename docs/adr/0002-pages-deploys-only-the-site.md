# GitHub Pages deploys only the site files

Pages "deploy from branch" can publish only the repo root or `/docs`, and publishing the
root of a monorepo serves every tool's source as part of the website. Instead, a GitHub
Actions deploy uploads just the site (`index.html`, `data/`, `leth/`, `CNAME`); Leth is served only at `/leth/`, and its old subdomain is retired. The site
stays at the repo root, so the refresh workflow's paths and the `data/` layout are
unchanged. Moving the site into `site/` was cleaner, but it would have moved every data
path and the collector with it.
