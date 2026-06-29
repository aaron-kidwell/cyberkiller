<?php
$user = $_GET['user'] ?? '';
$pass = $_GET['pass'] ?? '';
if ($user === 'admin' && $pass === 'password') {
  echo '<p>Welcome admin - check user flag path in ckplayer home.</p>';
} else {
  echo '<form>user <input name="user"> pass <input name="pass"><button>login</button></form>';
  echo '<p>Hint: classic DVWA defaults.</p>';
}
