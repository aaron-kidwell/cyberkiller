<?php
$host = $_GET['host'] ?? '127.0.0.1';
// Vulnerable to injection - filter weak
if (preg_match('/[;&|]/', $host)) {
  echo 'blocked';
  exit;
}
echo '<pre>' . shell_exec('ping -c 1 ' . $host) . '</pre>';
