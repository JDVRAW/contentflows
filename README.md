# ContentFlows

A delivery platform for creatives. Upload final photoshoots, music videos, commercials and other deliverables, then send your client one private link where they can view, stream and download everything in full quality.

## Features

- **Creator accounts** with a Profile page: name, login email, password, the brand/studio name shown to clients, and (Pro and up) their logo
- **Your logo on deliveries** (Pro and Studio): upload a version for light backgrounds and one for dark, and it replaces the studio name at the top of every delivery and on the password page. On Free, or after a downgrade, clients see the studio name and the saved logo comes back on upgrade. Logos live in `DATA_DIR/brand`.
- **Deliveries** (photoshoot, personal branding shoot, music video, commercial, commercial AD, campaign, brand kit, film, podcast, final project) with client name, email and a personal message
- **Drag-and-drop uploads** with per-file progress, any file type, large files supported (default limit 10 GB per file). With object storage set up, files go straight from the browser to the bucket in parts, so big videos never pass through the server
- **Organizing files**: on a delivery's page the creator can make folders, tick several files (or a whole folder, shift-click for a range) and move them to any folder (or a new one) from the bar that appears, or drag files onto a folder. The same bar deletes just the ticked files. Removing a folder keeps its files and moves them up a level. Each folder has an arrow to fold it shut (or "Close all"), and the page remembers which ones are closed
- **Folding folders on the client page**: folders start closed so the client sees them all at once, then opens the ones they want (gallery and files list) with the arrow or the name; their browser remembers which ones they opened
- **Folder names and order**: "Rename" changes a folder's name as often as needed (its files, subfolders, link and settings stay with it), and the ↑ ↓ arrows set the order folders appear in, which is also the order the client sees (for example Photos, then Videos, then BTS)
- **Folder links**: "Share this folder" on a folder makes its own link. Whoever opens it sees and downloads only that folder (and the folders inside it), never the rest of the delivery: the page, thumbnails, files and zips all refuse anything outside it. It follows the delivery's password, expiry and download settings, and "Turn off link" stops it working
- **Automatic thumbnails and video poster frames** via ffmpeg
- **Client delivery page**: cinematic cover, a large-type note from the studio with files, size and expiry at a glance, a gallery laid out like the "One link" scene on the home page (a sand board with a copyable link pill, a Photos/Films switch, and an even grid of rounded tiles where the first tile widens so every row is full), hover download and film previews, pick several files and download just those as one zip, a full-screen viewer with keyboard and swipe navigation, a files list with built-in audio players, and a closing Download all
- **Downloads**: single files, a picked selection (`/d/:token/zip?ids=1,2,3`), or "Download all" as a zip
- **Link controls**: optional password, expiry date, downloads on/off, regenerate link to revoke the old one
- **Security**: delivery links carry a random 128-bit code; passwords are stored as bcrypt hashes; after 10 wrong passwords from one address, or 30 in total, a delivery or account refuses more tries for 15 minutes. Files in R2 are served through signed links that expire after 6 hours. Only photos, video and audio open in the browser; any other file downloads, and files on the server's disk are sent with a `sandbox` policy, so an uploaded HTML or SVG file can't run as a page
- **Email the link**: under the delivery link, "Email the link to your client" sends the client a short branded email (the studio's logo on Pro and Studio when it's a PNG, JPG or WebP, otherwise the studio name), with the delivery's title, the personal message, file count and size, expiry, and a "View your files" button. It comes from "Studio via ContentFlows" and replies go to the creator's own email. Up to 5 addresses at a time, each sent separately; the password is never included. Each creator can email 50 addresses a day (`MAIL_DAILY_LIMIT`). Needs `RESEND_API_KEY` and `MAIL_FROM` (see Email below); without them the box says email isn't set up
- **Tracking**: views and downloads per delivery and per file
- **AI assistants (MCP)**: creators make an API key under Connect AI and add ContentFlows as a connector in Claude or any MCP app, which can then create deliveries, add files from links and hand back the share link (see below)
- **Storage plans**: Free (10 GB), Pro ($12/month, 250 GB) and Studio ($29/month, 1 TB), yearly at 10× the monthly price. The limit is the total size of the files a creator keeps, shown as a meter on the dashboard and checked before each upload. Upgrades, plan changes and cancellations go through Stripe

## Brand

Logo, symbol and app icons live in `public/brand/` and `public/icons/` (favicon, apple-touch-icon, 192/512 PWA icons, web manifest). The header logo is inlined so it follows the header's light/dark colour; the red square and dot always stay brand red `#E5402A`. Buttons use the darker action red `#D93A24` for contrast.

The four squares are animated in CSS (`.cf-symbol` in `public/styles.css`): on the landing hero the dark squares pop in and the red one appears in its grid slot then breaks out, followed by a slow loop where the dark squares pulse one by one and the red one tucks back into the grid and springs out. The same motion, faster, is the upload loader, and hovering the header logo tucks the red square in. All of it is off when the visitor prefers reduced motion.

## Design

The header, "Explore" menu and full-screen hero are adapted from the 1367 Studio site (via Details): a centered-logo header that turns into a frosted pill on scroll and picks light or dark text from what is under it, a menu card that scales open with staggered rising lines, rolling hover labels with sibling dimming, and a minimal full-bleed hero with the headline bottom-left and mono copy plus a red CTA bottom-right. On client pages the hero shows the delivery's cover (a muted looping video if the cover is a video). Replace `public/hero.jpg` with your own work for the landing page.

The landing page header is adapted from Antimetal (via Details): logo on the left, centred links with a small dot that slides under whichever link you hover (spring 240/23), a two-column "Product" mega-menu that opens on hover with a fade, 12px drop, slight scale and blur (spring 400/22, written as a CSS `linear()` easing) and closes 100ms after the pointer leaves, rows that reveal an arrow and nudge their red icon accent on hover, and Log in plus a red "Start delivering" pill on the right. It turns frosted with a hairline once you scroll and follows the light or dark section underneath. On phones the links fold into a full-screen menu. Code: `amNav()` in `src/views.js`, `public/am-nav.js`. The client delivery page uses the same bar with the studio's name as the logo, Gallery and Files links, and a red Download all button (`deliveryHeader()` in `src/views.js`). The creator app pages keep the 1367-style header.

The end of the landing page is adapted from the Hasan Wali site (via Details): after "How it works" a tall section holds a cream-to-red-to-black arch (`public/arch.jpg`) that unfolds as you scroll (it starts folded flat with `rotateX(90deg)` and opens to flat over one section height, see `public/landing.js`), handing off into a full-height black footer with the closing call to action, footer links and logo. On desktop the pointer is followed by a small square that inverts what is under it (`.cursor-sq`, spring motion); it never shows on touch devices or with reduced motion. To drop the cursor, delete the last block in `public/landing.js`.

"Why ContentFlows" keeps each point to a title and one line, each with a small looping scene above it (pure CSS in `public/styles.css`, `.pv-*`): the same file size going in and coming out, three uploads filling side by side until "Link ready" pops, and a link being tapped that opens into a gallery. The scenes start when they scroll into view and are still frames with reduced motion.

Right after the hero, a full-screen drop section is inspired by fourmula.ai: rounded cubes in brand colours ride three spiral arms from the edges into a circle in the middle that just says "Drop your files" (`public/spiral.js`, CSS 3D, no libraries). The cursor pushes cubes aside and sets them spinning, hovering the circle speeds the spiral up, and dragging files over speeds it up more. Each dropped file becomes a cube wearing its own thumbnail (images and video frames are read in the browser) that flies into the centre; the circle then shows the file count and size with a single "Send them" button that leads to sign-up. On the landing page nothing is uploaded. The same spiral sits behind the real upload area on a project page, where dropped files fly in while they upload. Animation pauses when off screen and is static with reduced motion.

## AI assistants (MCP)

ContentFlows is also a remote [MCP](https://modelcontextprotocol.io) server, so Claude, ChatGPT, Cursor and other assistants can work on a creator's deliveries when asked ("create a photoshoot delivery for Ana, add the photos from this Dropbox link and give me the link").

- **Keys**: on `/connect` (Connect AI in the header) a creator makes a named API key. It's shown once; only its SHA-256 hash is stored. Keys can be revoked there, and the page shows when each was last used.
- **Address**: `POST /mcp/<key>` (for apps whose connector screen only takes a URL, like Claude's custom connectors), or `POST /mcp` with `Authorization: Bearer <key>`. Streamable HTTP, stateless, JSON responses. Keys in addresses are masked in error logs.
- **Tools**: `list_deliveries`, `get_delivery`, `create_delivery`, `update_delivery` (title, client, message, password, expiry, downloads), `add_file_from_url`, `set_cover`, `remove_file`, `new_share_link`, `get_storage`. Every tool only sees the key owner's deliveries. Deleting a whole delivery is left to the app.
- **Files by link**: `add_file_from_url` downloads a public http(s) link (Dropbox and Google Drive share links are turned into their download links), checks the per-file limit and the creator's plan while it downloads, makes a thumbnail, and stores the file on disk or in the bucket like any upload. Only public internet addresses are allowed: links to this server, private networks or cloud metadata addresses are refused, including after redirects. Very large videos are better uploaded in the app, since assistants stop waiting after a while.

Try it with Claude Code:

```bash
claude mcp add --transport http contentflows https://your-site/mcp/cf_your-key
```

## Run locally

Requires Node 20+ and ffmpeg (optional, for thumbnails).

```bash
npm install
npm start            # http://localhost:3000
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | SQLite database and uploaded files |
| `SESSION_SECRET` | generated | Cookie signing secret. If unset, one is generated on first start and saved as `DATA_DIR/.secret`. |
| `PUBLIC_URL` | request host | Base URL used for share links |
| `MAX_UPLOAD_MB` | `10240` | Max size per file |
| `FFMPEG_PATH` | `ffmpeg` | Path to ffmpeg binary |
| `NODE_ENV` | | Set to `production` for secure cookies (HTTPS) |
| `S3_ENDPOINT` | | Object storage address, e.g. `https://<account-id>.r2.cloudflarestorage.com` (a bucket name on the end is ignored) |
| `S3_BUCKET` | | Bucket name |
| `S3_ACCESS_KEY_ID` | | Access key of an API token with object read and write on the bucket |
| `S3_SECRET_ACCESS_KEY` | | Its secret |
| `RESEND_API_KEY` | | [Resend](https://resend.com) API key (Sending access is enough). Turns on "Email the link" |
| `MAIL_FROM` | | Address the emails come from, on a domain verified in Resend, e.g. `deliveries@yourdomain.com` |
| `MAIL_DAILY_LIMIT` | `50` | Addresses each creator can email per 24 hours |
| `S3_REGION` | `auto` | Region (R2 uses `auto`) |
| `S3_FORCE_PATH_STYLE` | | Set to `1` for services that need path-style URLs (MinIO, local test servers) |
| `STRIPE_SECRET_KEY` | | Stripe secret key (`sk_live_…` or `sk_test_…`). Turns on paid plans |
| `STRIPE_WEBHOOK_SECRET` | | Signing secret of the webhook endpoint (`whsec_…`) |
| `OWNER_EMAILS` | | Comma-separated login emails with no storage limit (the people running the site) |

When all four `S3_*` values are set, new uploads go to the bucket and clients stream and download them through signed links that last 6 hours. Without them, files are kept in `DATA_DIR/uploads`. Files uploaded before the switch keep working from the disk.

## Deploy

```bash
docker build -t contentflow .
docker run -p 3000:3000 -v contentflow-data:/data -e SESSION_SECRET=change-me contentflow
```

Works on any host with a persistent disk (Railway, Fly.io, Render, a VPS). Mount a volume at `/data`. `GET /healthz` returns `ok` when the server and database are up.

### Railway (recommended)

`railway.json` tells Railway to build the Dockerfile and use `/healthz` as the health check.

1. Push this project to a GitHub repository.
2. On railway.com, choose **New Project → Deploy from GitHub repo** and pick the repository.
3. Open the service, then **right-click the canvas → Volume** (or Settings → Volumes) and attach a volume with mount path `/data`. Uploads, thumbnails and the database live there, so they survive redeploys.
4. Under **Variables**, add `SESSION_SECRET` with a long random value (optional, one is generated if missing).
5. Under **Settings → Networking**, click **Generate Domain** for a `*.up.railway.app` address, or add your own domain and set the DNS record Railway shows you.
6. Every push to the main branch redeploys automatically.

With object storage set up (below), the volume only holds the database and thumbnails, so the smallest size is enough. Without it, size the volume for the deliveries you expect: video adds up fast.

### Cloudflare R2 for the files

Big files should not pass through the app server: Railway's proxy and a small volume both get in the way of multi-GB uploads. With R2 the browser uploads each file straight to the bucket in 16 MB+ parts (four at a time, each retried if the connection drops), and clients download straight from R2, which has no download fees.

1. In the Cloudflare dashboard, open **R2 Object Storage** and create a bucket, e.g. `contentflows`.
2. In the bucket's **Settings → CORS policy**, add:
   ```json
   [{"AllowedOrigins":["*"],"AllowedMethods":["GET","PUT","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]
   ```
   `ExposeHeaders: ETag` is required: the browser reads it from each uploaded part. You can replace `*` in `AllowedOrigins` with your site's address.
3. Under **R2 → Manage API tokens**, create a token with **Object Read & Write** on that bucket.
4. In Railway → **Variables**, add `S3_ENDPOINT` (the S3 API address from the bucket's settings), `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. Railway redeploys on its own.

If something is off, the upload row says what: a wrong bucket name, a missing `ETag` in the CORS policy, or a token without access.

Keep the bucket's **Public access** (public development URL and custom domains) turned off. Clients only ever reach files through signed links the app creates after checking the delivery's password and expiry.

### Stripe for paid plans

Plans and prices live in `src/plans.js`. The matching Stripe products and prices are created automatically the first time someone picks a plan (lookup keys `cf_pro_month`, `cf_pro_year`, `cf_studio_month`, `cf_studio_year`), so nothing has to be set up by hand in Stripe's product catalog.

1. In Stripe → **Developers → API keys**, copy the **Secret key**. In Railway → **Variables**, add it as `STRIPE_SECRET_KEY`.
2. In Stripe → **Developers → Webhooks**, add an endpoint at `https://<your-site>/stripe/webhook` that listens for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`. Copy its **Signing secret** into Railway as `STRIPE_WEBHOOK_SECRET`.
3. In Stripe → **Settings → Billing → Customer portal**, click **Save** once so the "Manage billing" button can open it (card updates and invoices).
4. Add your own login email to `OWNER_EMAILS` so your account has no storage limit.

Use test-mode keys (`sk_test_…`) first and pay with the card `4242 4242 4242 4242`. Without `STRIPE_SECRET_KEY` the plans page still shows, and paid plans say "Available soon".

### Email with Resend

"Email the link" sends through [Resend](https://resend.com) (free for 3,000 emails a month, 100 a day).

1. Sign up at resend.com, open **Domains → Add domain** and add the domain the site runs on (or a subdomain such as `mail.yourdomain.com`).
2. Add the DNS records Resend shows (SPF, DKIM and the MX for bounces) where your domain's DNS lives, and wait for the domain to show **Verified**. Until it is, Resend only delivers to your own account's address.
3. Under **API Keys**, create a key with **Sending access**.
4. In Railway → **Variables**, add `RESEND_API_KEY` and `MAIL_FROM` (e.g. `deliveries@yourdomain.com`). Railway redeploys on its own.

Emails go out as "Studio name via ContentFlows <deliveries@yourdomain.com>" with Reply-To set to the creator, so client replies land in the creator's inbox.

## Structure

```
server.js        routes: auth, creator dashboard, uploads, client delivery, downloads
src/db.js        SQLite schema (users, sessions, projects, assets, events)
src/media.js     file type detection and ffmpeg thumbnails
src/storage.js   object storage (R2/S3): multipart uploads, signed links
src/plans.js     storage plans, prices and limits
src/billing.js   Stripe: checkout, plan changes, cancel, billing portal, webhook
src/mail.js      Resend email and the branded delivery email
src/views.js     server-rendered HTML
public/          styles, nav menu, upload client, gallery lightbox, landing hero image
```

## Next steps

- Video transcoding to HLS for adaptive streaming
- Client favorites, comments and approval
- Email the creator when a client opens or downloads a delivery
- More branding (colors, custom domain)
- Payments to unlock downloads
