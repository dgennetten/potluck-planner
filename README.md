# Potluck Planner

A small, mobile-friendly potluck sign-up app (live at https://potluck.gennetten.org). Organizers create a potluck, add people and dish categories, and everyone drags dishes from a shared "reservoir" onto a person. When a blank dish lands on a person, the app asks what they're bringing (skipped when the dish already has a name). Guest changes can trigger batched email notifications to the organizer.

## Stack
- Front end: plain HTML/CSS/vanilla JS (`web/index.html`, `web/app.js`, `web/style.css`), no build step.
- Back end: one PHP file (`web/api.php`) storing each potluck as JSON on disk. Two roles: user (guest) and admin (organizer), each with its own password.
- Hosting: DreamHost shared hosting; email via PHPMailer + SMTP (optional).

## Deploy layout (on the server)
```
~/potluck.gennetten.org/        <- web root: contents of web/ (index.html, app.js, style.css, api.php, .htaccess)
~/potluck-private/              <- NOT web-served (Require all denied)
    .htaccess                   <- private-example/.htaccess
    config.php                  <- your real config (see private-example/config.example.php); chmod 600
    data/                       <- potluck JSON files; chmod 700
```
`api.php` loads `../potluck-private/config.php` relative to the web root.

## Setup
1. Copy `web/*` (including `.htaccess`) to the web root.
2. Create `potluck-private/`, copy `private-example/.htaccess` into it, copy `private-example/config.example.php` to `config.php`, fill in password hashes and email settings, and `chmod 600 config.php`.
3. `chmod 700 potluck-private potluck-private/data` and check `php -l web/api.php`.

## Not in this repo
Real `config.php`, any `.env`, deploy credentials, and server data (see `.gitignore`).
