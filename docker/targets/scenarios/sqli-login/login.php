<?php
// Intentionally vulnerable - string concat query
$user = $_GET['user'] ?? '';
$pass = $_GET['pass'] ?? '';
$q = "SELECT * FROM users WHERE user='$user' AND pass='$pass'";
echo "<!-- query: $q -->\n";
if ($user === "admin' --" || ($user === 'admin' && $pass === 'x')) {
  echo '<p>Authenticated. Foothold: ckplayer.</p>';
} else {
  echo '<p>Login failed. Try SQLi on user field.</p>';
}
