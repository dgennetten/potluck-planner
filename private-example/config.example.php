<?php
// Copy to ~/potluck-private/config.php on the server (OUTSIDE the web root). Never commit the real file.
// Generate a password hash with:
//   php -r 'echo password_hash("NEW-PASSWORD", PASSWORD_DEFAULT), "\n";'
return [
  'user_password_hash'  => 'PASTE_HASH_HERE',   // guest/user password
  'admin_password_hash' => 'PASTE_HASH_HERE',   // organizer/admin password
  'data_dir' => __DIR__ . '/data',               // JSON data lives here, not web-served
  // Guest-change email notifications (batched; sent by the next request after notify_batch_seconds).
  'notify_to' => 'you@example.com',
  'notify_from' => 'noreply@example.com',
  'notify_batch_seconds' => 300,
  // Optional: path to a PHP file returning ['smtp' => ['host','user','pass','port','secure']]
  'smtp_config_file' => '/home/USER/path/to/smtp-config.php',
  // Path to a PHPMailer checkout (expects src/PHPMailer.php, src/SMTP.php, src/Exception.php)
  'phpmailer_path' => '/home/USER/path/to/PHPMailer',
  'site_title' => 'Potluck Planner',
];
