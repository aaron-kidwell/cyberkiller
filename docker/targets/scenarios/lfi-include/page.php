<?php
$file = $_GET['file'] ?? 'welcome.txt';
include('/var/www/html/' . $file);
