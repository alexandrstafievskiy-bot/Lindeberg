<?php
/**
 * API Configuration
 * STROYKLIMAT Backend
 */

// Database
define('DB_PATH', __DIR__ . '/../data/stroyklimat.db');

// Admin credentials
$adminPassword = getenv('STROYKLIMAT_ADMIN_PASSWORD');
define('ADMIN_PASSWORD', ($adminPassword !== false && $adminPassword !== '') ? $adminPassword : 'CHANGE_ME');

// CORS settings
$allowOrigin = getenv('STROYKLIMAT_ALLOW_ORIGIN');
define('ALLOW_ORIGIN', ($allowOrigin !== false && $allowOrigin !== '') ? $allowOrigin : '');

// Error reporting (вимкніть на продакшені)
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ini_set('error_log', __DIR__ . '/../data/api_errors.log');

// Timezone
date_default_timezone_set('Europe/Kiev');

function applyCorsHeaders() {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (ALLOW_ORIGIN === '*') {
        header('Access-Control-Allow-Origin: *');
    } elseif (ALLOW_ORIGIN !== '' && $origin === ALLOW_ORIGIN) {
        header('Access-Control-Allow-Origin: ' . ALLOW_ORIGIN);
        header('Vary: Origin');
    }
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
}

// JSON response helper
function jsonResponse($data, $statusCode = 200) {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    applyCorsHeaders();
    
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

// Error response helper
function errorResponse($message, $statusCode = 400) {
    jsonResponse([
        'success' => false,
        'error' => $message,
        'timestamp' => time()
    ], $statusCode);
}

// Success response helper
function successResponse($data = null, $message = null) {
    $response = [
        'success' => true,
        'timestamp' => time()
    ];
    
    if ($message) {
        $response['message'] = $message;
    }
    
    if ($data !== null) {
        $response['data'] = $data;
    }
    
    jsonResponse($response);
}
