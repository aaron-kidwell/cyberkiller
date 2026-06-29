<?php
if (($_GET['user'] ?? '') === 'admin' && ($_GET['pass'] ?? '') === 'admin') {
  echo '<p>Stage 1 clear. Continue enumeration.</p>';
} else {
  echo '<p>Need valid creds.</p>';
}
