<?php
echo '<pre>' . shell_exec('ping -c 1 ' . ($_GET['host'] ?? '127.0.0.1')) . '</pre>';
