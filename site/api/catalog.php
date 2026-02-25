<?php
/**
 * Catalog API Endpoint
 * REST API for product management
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/database.php';

// Handle CORS preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    applyCorsHeaders();
    http_response_code(200);
    exit;
}

// Get request method and path
$method = $_SERVER['REQUEST_METHOD'];
$path = $_GET['action'] ?? 'list';

// Initialize database lazily (auth route does not need DB)
$db = null;
if ($path !== 'auth') {
    try {
        $db = Database::getInstance();
    } catch (Exception $e) {
        errorResponse('Database connection failed', 500);
    }
}

// Get JSON input for POST/PUT/DELETE
$input = null;
if (in_array($method, ['POST', 'PUT', 'DELETE'])) {
    $input = json_decode(file_get_contents('php://input'), true);
    if (json_last_error() !== JSON_ERROR_NONE && $method !== 'DELETE') {
        errorResponse('Invalid JSON input');
    }
}

// Check admin authentication for write operations
function checkAuth($input) {
    if (ADMIN_PASSWORD === 'CHANGE_ME') {
        errorResponse('Server admin password is not configured', 500);
    }
    $provided = isset($input['password']) ? (string)$input['password'] : '';
    if ($provided === '' || !hash_equals(ADMIN_PASSWORD, $provided)) {
        errorResponse('Unauthorized', 401);
    }
}

// === ROUTES ===

switch ($path) {
    case 'auth':
        if ($method !== 'POST') {
            errorResponse('Method not allowed', 405);
        }
        checkAuth($input);
        successResponse(['authenticated' => true], 'Authorized');
        break;
    
    // GET /api/catalog.php?action=list
    // Отримати весь каталог
    case 'list':
        if ($method !== 'GET') {
            errorResponse('Method not allowed', 405);
        }
        
        $products = $db->getAllProducts();
        successResponse([
            'products' => $products,
            'total' => count($products),
            'lastUpdate' => $db->getLastUpdateTime()
        ]);
        break;
    
    // GET /api/catalog.php?action=get&id=p123
    // Отримати один товар
    case 'get':
        if ($method !== 'GET') {
            errorResponse('Method not allowed', 405);
        }
        
        $id = $_GET['id'] ?? null;
        if (!$id) {
            errorResponse('Product ID required');
        }
        
        $product = $db->getProductById($id);
        if (!$product) {
            errorResponse('Product not found', 404);
        }
        
        successResponse(['product' => $product]);
        break;
    
    // POST /api/catalog.php?action=create
    // Створити новий товар
    case 'create':
        if ($method !== 'POST') {
            errorResponse('Method not allowed', 405);
        }
        
        checkAuth($input);
        
        if (!isset($input['product'])) {
            errorResponse('Product data required');
        }
        
        $productData = $input['product'];
        
        // Валідація
        if (empty($productData['title'])) {
            errorResponse('Product title is required');
        }
        
        $id = $db->createProduct($productData);
        
        if ($id) {
            successResponse([
                'id' => $id,
                'product' => $db->getProductById($id)
            ], 'Product created successfully');
        } else {
            errorResponse('Failed to create product', 500);
        }
        break;
    
    // PUT /api/catalog.php?action=update
    // Оновити товар
    case 'update':
        if ($method !== 'PUT') {
            errorResponse('Method not allowed', 405);
        }
        
        checkAuth($input);
        
        if (!isset($input['product']) || !isset($input['product']['id'])) {
            errorResponse('Product data with ID required');
        }
        
        $productData = $input['product'];
        $id = $productData['id'];
        
        // Перевірка чи існує товар
        if (!$db->getProductById($id)) {
            errorResponse('Product not found', 404);
        }
        
        if ($db->updateProduct($id, $productData)) {
            successResponse([
                'product' => $db->getProductById($id)
            ], 'Product updated successfully');
        } else {
            errorResponse('Failed to update product', 500);
        }
        break;
    
    // DELETE /api/catalog.php?action=delete
    // Видалити товар
    case 'delete':
        if ($method !== 'DELETE') {
            errorResponse('Method not allowed', 405);
        }
        
        checkAuth($input);
        
        $id = $input['id'] ?? null;
        if (!$id) {
            errorResponse('Product ID required');
        }
        
        if (!$db->getProductById($id)) {
            errorResponse('Product not found', 404);
        }
        
        if ($db->deleteProduct($id)) {
            successResponse(null, 'Product deleted successfully');
        } else {
            errorResponse('Failed to delete product', 500);
        }
        break;
    
    // POST /api/catalog.php?action=import
    // Імпортувати весь каталог (замінити всі товари)
    case 'import':
        if ($method !== 'POST') {
            errorResponse('Method not allowed', 405);
        }
        
        checkAuth($input);
        
        if (!isset($input['products']) || !is_array($input['products'])) {
            errorResponse('Products array required');
        }
        
        if ($db->bulkImportProducts($input['products'])) {
            successResponse([
                'imported' => count($input['products']),
                'total' => count($db->getAllProducts())
            ], 'Catalog imported successfully');
        } else {
            errorResponse('Failed to import catalog', 500);
        }
        break;
    
    // GET /api/catalog.php?action=categories
    // Отримати список категорій
    case 'categories':
        if ($method !== 'GET') {
            errorResponse('Method not allowed', 405);
        }
        
        $categories = $db->getCategories();
        successResponse(['categories' => $categories]);
        break;
    
    // GET /api/catalog.php?action=stats
    // Отримати статистику
    case 'stats':
        if ($method !== 'GET') {
            errorResponse('Method not allowed', 405);
        }
        
        $stats = $db->getStats();
        successResponse(['stats' => $stats]);
        break;
    
    // GET /api/catalog.php?action=timestamp
    // Перевірити час останнього оновлення
    case 'timestamp':
        if ($method !== 'GET') {
            errorResponse('Method not allowed', 405);
        }
        
        successResponse([
            'timestamp' => $db->getLastUpdateTime()
        ]);
        break;
    
    default:
        errorResponse('Unknown action', 404);
}
