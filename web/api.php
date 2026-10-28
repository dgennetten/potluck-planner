<?php
declare(strict_types=1);
$cfgPath = dirname(__DIR__) . '/potluck-private/config.php';
$CFG = require $cfgPath;
$DATA = $CFG['data_dir'];
if (!is_dir($DATA)) mkdir($DATA, 0700, true);
session_name('potluck_sid');
session_set_cookie_params(['lifetime' => 60*60*24*60, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => !empty($_SERVER['HTTPS'])]);
ini_set('session.gc_maxlifetime', (string)(60*60*24*60));
if (is_dir($DATA)) { @mkdir("$DATA/sessions", 0700); session_save_path("$DATA/sessions"); }
session_start();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function out($d, int $code = 200) { http_response_code($code); echo json_encode($d); exit; }
function fail(string $m, int $c = 400) { out(['error' => $m], $c); }
function role() { return $_SESSION['role'] ?? null; }
function need(string $r) { $cur = role(); if (!$cur || ($r === 'admin' && $cur !== 'admin')) fail('Not authorized', 401); }
function uid() { return bin2hex(random_bytes(6)); }
function clean($s, int $max = 80): string { return mb_substr(trim(preg_replace('/\s+/u', ' ', (string)$s)), 0, $max); }
function checkPw(string $pw, string $which): bool {
  global $CFG;
  if (!empty($CFG[$which . '_password_hash'])) return password_verify($pw, $CFG[$which . '_password_hash']);
  if (isset($CFG[$which . '_password']) && $CFG[$which . '_password'] !== '') return hash_equals((string)$CFG[$which . '_password'], $pw);
  return false;
}
function dbFile() { global $DATA; return "$DATA/potlucks.json"; }
// Run fn with exclusive lock; fn receives &$db and may modify it.
function withDb(callable $fn, bool $write) {
  $f = fopen(dbFile(), 'c+'); if (!$f) fail('Storage error', 500);
  flock($f, $write ? LOCK_EX : LOCK_SH);
  $raw = stream_get_contents($f);
  $db = $raw ? json_decode($raw, true) : null;
  if (!is_array($db)) $db = ['potlucks' => []];
  $res = $fn($db);
  if ($write) { ftruncate($f, 0); rewind($f); fwrite($f, json_encode($db, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)); fflush($f); }
  flock($f, LOCK_UN); fclose($f);
  return $res;
}
function &findP(array &$db, $id) { foreach ($db['potlucks'] as &$p) if ($p['id'] === $id) return $p; fail('Potluck not found', 404); }
function catLabel(array $p, $cid): string { foreach ($p['categories'] as $c) if ($c['id'] === $cid) return $c['name']; return 'Item'; }
function itemLabel(array $p, array $it): string { $c = catLabel($p, $it['cat']); return $it['sub'] !== '' ? "{$it['sub']} ($c)" : $c; }
function ownerName(array $p, $oid): string { if (!$oid) return 'the reservoir'; foreach ($p['people'] as $x) if ($x['id'] === $oid) return $x['name']; return '?'; }
function idx(array $list, $id) { foreach ($list as $i => $x) if ($x['id'] === $id) return $i; fail('Not found', 404); }


// ---- guest change notifications ----
function pendFile() { global $DATA; return "$DATA/pending_notify.json"; }
function queueChange(string $potluck, string $text) {
  $f = fopen(pendFile(), 'c+'); flock($f, LOCK_EX);
  $q = json_decode(stream_get_contents($f) ?: '', true) ?: ['first' => 0, 'changes' => []];
  if (!$q['changes']) $q['first'] = time();
  $q['changes'][] = ['t' => time(), 'p' => $potluck, 'x' => $text];
  ftruncate($f, 0); rewind($f); fwrite($f, json_encode($q)); fflush($f); flock($f, LOCK_UN); fclose($f);
}
function flushChanges(bool $force = false) {
  global $CFG;
  if (empty($CFG['notify_to']) || !file_exists(pendFile())) return null;
  $f = fopen(pendFile(), 'c+'); if (!flock($f, LOCK_EX | LOCK_NB)) { fclose($f); return null; }
  $q = json_decode(stream_get_contents($f) ?: '', true) ?: ['first' => 0, 'changes' => []];
  $wait = (int)($CFG['notify_batch_seconds'] ?? 300);
  if (!$q['changes'] || (!$force && time() - $q['first'] < $wait)) { flock($f, LOCK_UN); fclose($f); return null; }
  $ok = sendChangeMail($q['changes']);
  if ($ok) { ftruncate($f, 0); rewind($f); fwrite($f, json_encode(['first' => 0, 'changes' => []])); fflush($f); }
  flock($f, LOCK_UN); fclose($f);
  return $ok;
}
function sendChangeMail(array $changes): bool {
  global $CFG;
  $tz = new DateTimeZone('America/Denver');
  $by = [];
  foreach ($changes as $c) $by[$c['p']][] = $c;
  $lines = []; $html = '<div style="font-family:sans-serif">';
  foreach ($by as $p => $cs) {
    $lines[] = "== $p =="; $html .= '<h3 style="color:#b8481b">' . htmlspecialchars($p) . '</h3><ul>';
    foreach ($cs as $c) {
      $t = (new DateTime('@' . $c['t']))->setTimezone($tz)->format('M j, g:i A T');
      $lines[] = "- $t: {$c['x']}"; $html .= '<li><b>' . htmlspecialchars($t) . '</b>: ' . htmlspecialchars($c['x']) . '</li>';
    }
    $lines[] = ''; $html .= '</ul>';
  }
  $n = count($changes);
  $subject = "Potluck: $n guest change" . ($n === 1 ? '' : 's') . ' (' . implode(', ', array_keys($by)) . ')';
  $html .= '<p><a href="https://potluck.gennetten.org">https://potluck.gennetten.org</a></p></div>';
  $text = implode("\n", $lines) . "\nhttps://potluck.gennetten.org\n";
  $from = $CFG['notify_from'] ?? 'noreply@gennetten.org';
  $smtp = null;
  if (!empty($CFG['smtp_config_file']) && is_readable($CFG['smtp_config_file'])) {
    $hc = (function ($file) { $r = include $file; return is_array($r) ? $r : (isset($config) && is_array($config) ? $config : []); })($CFG['smtp_config_file']);
    $smtp = $hc['smtp'] ?? null;
  }
  $base = rtrim($CFG['phpmailer_path'] ?? '', '/') . '/src';
  if ($smtp && file_exists("$base/PHPMailer.php")) {
    require_once "$base/Exception.php"; require_once "$base/PHPMailer.php"; require_once "$base/SMTP.php";
    try {
      $m = new PHPMailer\PHPMailer\PHPMailer(true);
      $m->isSMTP(); $m->Host = $smtp['host']; $m->SMTPAuth = true; $m->Username = $smtp['user']; $m->Password = $smtp['pass'];
      $m->SMTPSecure = !empty($smtp['secure']) ? 'tls' : ''; $m->Port = $smtp['port']; $m->CharSet = 'UTF-8';
      $m->setFrom($from, 'Potluck Planner'); $m->addAddress($CFG['notify_to']);
      $m->Subject = $subject; $m->isHTML(true); $m->Body = $html; $m->AltBody = $text;
      $m->send(); error_log("Potluck notify: sent $n change(s) via SMTP"); return true;
    } catch (Throwable $e) { error_log('Potluck notify PHPMailer error: ' . $e->getMessage()); }
  }
  $h = "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nFrom: $from\r\nReply-To: $from\r\n";
  $ok = @mail($CFG['notify_to'], $subject, $text, $h);
  error_log('Potluck notify mail(): ' . ($ok ? 'ok' : 'FAILED'));
  return $ok;
}

$in = json_decode(file_get_contents('php://input') ?: '{}', true) ?: [];
$a = $_GET['a'] ?? ($in['a'] ?? '');
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $a !== 'login') {
  // simple CSRF guard: require custom header (cannot be sent cross-site without CORS)
  if (($_SERVER['HTTP_X_POTLUCK'] ?? '') !== '1') fail('Bad request', 403);
}

try { flushChanges(); } catch (Throwable $e) { error_log('Potluck flush: ' . $e->getMessage()); }
switch ($a) {
  case 'me': out(['role' => role(), 'title' => $CFG['site_title'] ?? 'Potluck']);
  case 'login':
    $pw = (string)($in['password'] ?? '');
    usleep(300000);
    if (checkPw($pw, 'admin')) $r = 'admin'; elseif (checkPw($pw, 'user')) $r = 'user'; else fail('Wrong password', 401);
    session_regenerate_id(true); $_SESSION['role'] = $r; out(['role' => $r]);
  case 'flushNotify': need('admin'); out(['sent' => flushChanges(true)]);
  case 'logout': $_SESSION = []; session_destroy(); out(['ok' => true]);
  case 'list':
    need('user');
    out(withDb(function (&$db) { return array_map(fn($p) => ['id' => $p['id'], 'name' => $p['name'], 'date' => $p['date'], 'time' => $p['time'], 'count' => count($p['items']), 'claimed' => count(array_filter($p['items'], fn($i) => $i['owner']))], $db['potlucks']); }, false));
  case 'get':
    need('user'); $id = $_GET['id'] ?? '';
    out(withDb(function (&$db) use ($id) { return findP($db, $id); }, false));
}

// ---- mutations ----
need('user');
$pid = $in['id'] ?? '';
$res = withDb(function (&$db) use ($a, $in, $pid) {
  $admin = role() === 'admin';
  if ($a === 'createPotluck') {
    if (!$admin) fail('Admin only', 403);
    $name = clean($in['name'] ?? ''); if ($name === '') fail('Name required');
    $p = ['id' => uid(), 'name' => $name, 'date' => clean($in['date'] ?? '', 10), 'time' => clean($in['time'] ?? '', 5),
      'location' => clean($in['location'] ?? '', 120), 'notes' => clean($in['notes'] ?? '', 500), 'rev' => 1,
      'categories' => [], 'people' => [], 'items' => []];
    foreach (['Appetizer', 'Entree', 'Side', 'Dessert', 'Drinks'] as $c) $p['categories'][] = ['id' => uid(), 'name' => $c];
    $db['potlucks'][] = $p; return $p;
  }
  $p = &findP($db, $pid);
  switch ($a) {
    // user-level actions
    case 'move':
      $i = idx($p['items'], $in['item'] ?? ''); $o = $in['owner'] ?? null;
      if ($o !== null) idx($p['people'], $o);
      $old = $p['items'][$i]['owner'] ?? null;
      if ($old !== $o) $GLOBALS['CHANGE'] = itemLabel($p, $p['items'][$i]) . ' moved from ' . ownerName($p, $old) . ' to ' . ownerName($p, $o);
      $p['items'][$i]['owner'] = $o;
      // reorder: place item before 'before' id if given, else at end
      $it = $p['items'][$i]; array_splice($p['items'], $i, 1);
      $pos = count($p['items']);
      if (!empty($in['before'])) foreach ($p['items'] as $k => $x) if ($x['id'] === $in['before']) { $pos = $k; break; }
      array_splice($p['items'], $pos, 0, [$it]); break;
    case 'sub': $i = idx($p['items'], $in['item'] ?? ''); $ns = clean($in['sub'] ?? '', 60); $os = $p['items'][$i]['sub'];
      if ($ns !== $os) $GLOBALS['CHANGE'] = catLabel($p, $p['items'][$i]['cat']) . ' renamed from "' . ($os === '' ? '(blank)' : $os) . '" to "' . ($ns === '' ? '(blank)' : $ns) . '" (' . ownerName($p, $p['items'][$i]['owner']) . ')';
      $p['items'][$i]['sub'] = $ns; break;
    default:
      if (!$admin) fail('Admin only', 403);
      switch ($a) {
        case 'updatePotluck':
          foreach (['name' => 80, 'date' => 10, 'time' => 5, 'location' => 120, 'notes' => 500] as $k => $m) if (isset($in[$k])) $p[$k] = clean($in[$k], $m);
          if ($p['name'] === '') fail('Name required'); break;
        case 'deletePotluck':
          $db['potlucks'] = array_values(array_filter($db['potlucks'], fn($x) => $x['id'] !== $p['id'])); return ['deleted' => true];
        case 'addPerson': $n = clean($in['name'] ?? ''); if ($n === '') fail('Name required'); $p['people'][] = ['id' => uid(), 'name' => $n]; break;
        case 'renamePerson': $n = clean($in['name'] ?? ''); if ($n === '') fail('Name required'); $p['people'][idx($p['people'], $in['person'] ?? '')]['name'] = $n; break;
        case 'removePerson':
          $k = idx($p['people'], $in['person'] ?? ''); $rid = $p['people'][$k]['id']; array_splice($p['people'], $k, 1);
          foreach ($p['items'] as &$it) if ($it['owner'] === $rid) $it['owner'] = null; unset($it); break;
        case 'movePerson':
          $k = idx($p['people'], $in['person'] ?? ''); $t = max(0, min(count($p['people']) - 1, $k + (int)($in['dir'] ?? 0)));
          $x = $p['people'][$k]; array_splice($p['people'], $k, 1); array_splice($p['people'], $t, 0, [$x]); break;
        case 'addCategory': $n = clean($in['name'] ?? '', 40); if ($n === '') fail('Name required'); $p['categories'][] = ['id' => uid(), 'name' => $n]; break;
        case 'renameCategory': $n = clean($in['name'] ?? '', 40); if ($n === '') fail('Name required'); $p['categories'][idx($p['categories'], $in['cat'] ?? '')]['name'] = $n; break;
        case 'removeCategory':
          $cid = $in['cat'] ?? ''; idx($p['categories'], $cid);
          $p['categories'] = array_values(array_filter($p['categories'], fn($c) => $c['id'] !== $cid));
          $p['items'] = array_values(array_filter($p['items'], fn($i) => $i['cat'] !== $cid)); break;
        case 'addItems':
          $cid = $in['cat'] ?? ''; idx($p['categories'], $cid); $n = max(1, min(30, (int)($in['count'] ?? 1)));
          for ($j = 0; $j < $n; $j++) $p['items'][] = ['id' => uid(), 'cat' => $cid, 'sub' => clean($in['sub'] ?? '', 60), 'owner' => null]; break;
        case 'removeItem': $k = idx($p['items'], $in['item'] ?? ''); array_splice($p['items'], $k, 1); break;
        default: fail('Unknown action');
      }
  }
  $p['rev'] = ($p['rev'] ?? 0) + 1;
  return $p;
}, true);
if (role() !== 'admin' && !empty($GLOBALS['CHANGE'])) queueChange($res['name'] ?? 'Potluck', $GLOBALS['CHANGE']);
out($res);
