<?php
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['f'])) {
  $dest = '/var/www/html/' . basename($_FILES['f']['name']);
  move_uploaded_file($_FILES['f']['tmp_name'], $dest);
  echo "uploaded to $dest";
} else {
  echo '<form method="post" enctype="multipart/form-data"><input type="file" name="f"><button>upload</button></form>';
}
