# API测试脚本 - 使用curl测试所有API端点

Write-Host "`n========================================" -ForegroundColor Blue
Write-Host "AI4WEB 测试平台 - API 完整测试" -ForegroundColor Blue
Write-Host "========================================`n" -ForegroundColor Blue

$BASE_URL = "http://localhost:3000"
$timestamp = Get-Date -Format "yyyyMMddHHmmss"

# 存储测试数据
$script:test_user = @{
    email = "test_$timestamp@example.com"
    username = "testuser_$timestamp"
    password = "TestPass123!"
    name = "Test User"
}
$script:token = $null
$script:user_id = $null
$script:role_id = $null
$script:permission_id = $null
$script:config_id = $null
$script:session_id = $null

function Test-Endpoint {
    param(
        [string]$method,
        [string]$endpoint,
        [string]$description,
        [object]$body = $null,
        [string]$token = $null
    )
    
    $headers = @{}
    if ($token) {
        $headers["Authorization"] = "Bearer $token"
    }
    if ($body) {
        $headers["Content-Type"] = "application/json"
    }
    
    try {
        if ($method -eq "GET") {
            if ($headers.Count -gt 0) {
                $response = Invoke-RestMethod -Uri "$BASE_URL$endpoint" -Method GET -Headers $headers -ErrorAction Stop
            } else {
                $response = Invoke-RestMethod -Uri "$BASE_URL$endpoint" -Method GET -ErrorAction Stop
            }
        } elseif ($method -eq "POST") {
            $jsonBody = $body | ConvertTo-Json -Depth 10
            if ($headers.Count -gt 0) {
                $response = Invoke-RestMethod -Uri "$BASE_URL$endpoint" -Method POST -Headers $headers -Body $jsonBody -ErrorAction Stop
            } else {
                $response = Invoke-RestMethod -Uri "$BASE_URL$endpoint" -Method POST -Body $jsonBody -ErrorAction Stop
            }
        } elseif ($method -eq "PATCH") {
            $jsonBody = $body | ConvertTo-Json -Depth 10
            $response = Invoke-RestMethod -Uri "$BASE_URL$endpoint" -Method PATCH -Headers $headers -Body $jsonBody -ErrorAction Stop
        } elseif ($method -eq "DELETE") {
            $response = Invoke-RestMethod -Uri "$BASE_URL$endpoint" -Method DELETE -Headers $headers -ErrorAction Stop
        }
        
        Write-Host "✓ $method $endpoint - $description" -ForegroundColor Green
        return $response
    } catch {
        $errorMsg = $_.Exception.Message
        Write-Host "✗ $method $endpoint - 失败: $errorMsg" -ForegroundColor Red
        return $null
    }
}

# ==================== 1. 认证API测试 ====================
Write-Host "`n[1. 认证API测试]`n" -ForegroundColor Yellow

# 1.1 注册新用户
Write-Host "测试用户注册..." -ForegroundColor Cyan
$response = Test-Endpoint -method "POST" -endpoint "/api/auth/register" -description "注册新用户" -body $test_user
if ($response -and $response.user) {
    $script:user_id = $response.user.id
}

# 1.2 登录
Write-Host "测试用户登录..." -ForegroundColor Cyan
$loginBody = @{
    email = $test_user.email
    password = $test_user.password
}
$response = Test-Endpoint -method "POST" -endpoint "/api/auth/login" -description "用户登录" -body $loginBody
if ($response) {
    $script:token = $response.token
    if (-not $script:user_id -and $response.user) {
        $script:user_id = $response.user.id
    }
}

# ==================== 2. 用户管理API测试 ====================
Write-Host "`n[2. 用户管理API测试]`n" -ForegroundColor Yellow

# 2.1 获取所有用户
Write-Host "测试获取用户列表..." -ForegroundColor Cyan
$response = Test-Endpoint -method "GET" -endpoint "/api/users" -description "获取所有用户" -token $script:token
if ($response -and $response.users) {
    Write-Host "  用户数: $($response.users.Count)" -ForegroundColor Gray
}

# 2.2 获取单个用户
if ($script:user_id) {
    Write-Host "测试获取单个用户..." -ForegroundColor Cyan
    $response = Test-Endpoint -method "GET" -endpoint "/api/users/$($script:user_id)" -description "获取用户详情" -token $script:token
}

# 2.3 更新用户信息
if ($script:user_id) {
    Write-Host "测试更新用户信息..." -ForegroundColor Cyan
    $updateBody = @{ name = "Updated Test User" }
    $response = Test-Endpoint -method "PATCH" -endpoint "/api/users/$($script:user_id)" -description "更新用户信息" -body $updateBody -token $script:token
}

# ==================== 3. 角色管理API测试 ====================
Write-Host "`n[3. 角色管理API测试]`n" -ForegroundColor Yellow

# 3.1 获取所有角色
Write-Host "测试获取角色列表..." -ForegroundColor Cyan
$response = Test-Endpoint -method "GET" -endpoint "/api/roles" -description "获取所有角色" -token $script:token
if ($response -and $response.roles) {
    Write-Host "  角色数: $($response.roles.Count)" -ForegroundColor Gray
}

# 3.2 创建新角色
Write-Host "测试创建新角色..." -ForegroundColor Cyan
$roleBody = @{
    name = "test_role_$timestamp"
    description = "Test role for API testing"
}
$response = Test-Endpoint -method "POST" -endpoint "/api/roles" -description "创建新角色" -body $roleBody -token $script:token
if ($response -and $response.role) {
    $script:role_id = $response.role.id
}

# 3.3 为用户分配角色
if ($script:user_id -and $script:role_id) {
    Write-Host "测试为用户分配角色..." -ForegroundColor Cyan
    $assignBody = @{ roleIds = @($script:role_id) }
    $response = Test-Endpoint -method "POST" -endpoint "/api/users/$($script:user_id)/roles" -description "分配角色" -body $assignBody -token $script:token
}

# ==================== 4. 权限管理API测试 ====================
Write-Host "`n[4. 权限管理API测试]`n" -ForegroundColor Yellow

# 4.1 获取所有权限
Write-Host "测试获取权限列表..." -ForegroundColor Cyan
$response = Test-Endpoint -method "GET" -endpoint "/api/permissions" -description "获取所有权限" -token $script:token
if ($response -and $response.permissions) {
    Write-Host "  权限数: $($response.permissions.Count)" -ForegroundColor Gray
}

# 4.2 创建新权限
Write-Host "测试创建新权限..." -ForegroundColor Cyan
$permissionBody = @{
    name = "test:permission_$timestamp"
    module = "test"
    action = "test"
    resource = "test_resource"
}
$response = Test-Endpoint -method "POST" -endpoint "/api/permissions" -description "创建新权限" -body $permissionBody -token $script:token
if ($response -and $response.permission) {
    $script:permission_id = $response.permission.id
}

# ==================== 5. 配置管理API测试 ====================
Write-Host "`n[5. 配置管理API测试]`n" -ForegroundColor Yellow

# 5.1 获取配置列表
Write-Host "测试获取配置列表..." -ForegroundColor Cyan
$response = Test-Endpoint -method "GET" -endpoint "/api/config" -description "获取配置列表" -token $script:token
if ($response -and $response.configs) {
    Write-Host "  配置数: $($response.configs.Count)" -ForegroundColor Gray
}

# 5.2 创建新配置
Write-Host "测试创建新配置..." -ForegroundColor Cyan
$configBody = @{
    name = "Test Config $timestamp"
    baseURL = "http://localhost:54321"
    description = "Test configuration"
    isActive = $true
    mcpServers = '[{"name":"filesystem","type":"local"}]'
    keybinds = '{"save":"Ctrl+S"}'
    modelPreferences = '{"openai":{"model":"gpt-4"}}'
}
$response = Test-Endpoint -method "POST" -endpoint "/api/config" -description "创建新配置" -body $configBody -token $script:token
if ($response -and $response.config) {
    $script:config_id = $response.config.id
}

# 5.3 更新配置
if ($script:config_id) {
    Write-Host "测试更新配置..." -ForegroundColor Cyan
    $updateConfigBody = @{ description = "Updated test configuration" }
    $response = Test-Endpoint -method "PATCH" -endpoint "/api/config/$($script:config_id)" -description "更新配置" -body $updateConfigBody -token $script:token
}

# ==================== 6. 会话管理API测试 ====================
Write-Host "`n[6. 会话管理API测试]`n" -ForegroundColor Yellow

# 6.1 获取会话列表
Write-Host "测试获取会话列表..." -ForegroundColor Cyan
$response = Test-Endpoint -method "GET" -endpoint "/api/sessions" -description "获取会话列表" -token $script:token
if ($response -and $response.sessions) {
    Write-Host "  会话数: $($response.sessions.Count)" -ForegroundColor Gray
}

# 6.2 创建新会话
Write-Host "测试创建新会话..." -ForegroundColor Cyan
$sessionBody = @{
    title = "Test Session $timestamp"
    configId = $script:config_id
}
$response = Test-Endpoint -method "POST" -endpoint "/api/sessions" -description "创建新会话" -body $sessionBody -token $script:token
if ($response -and $response.session) {
    $script:session_id = $response.session.id
}

# 6.3 获取会话详情
if ($script:session_id) {
    Write-Host "测试获取会话详情..." -ForegroundColor Cyan
    $response = Test-Endpoint -method "GET" -endpoint "/api/sessions/$($script:session_id)" -description "获取会话详情" -token $script:token
}

# ==================== 7. 清理测试数据 ====================
Write-Host "`n[7. 清理测试数据]`n" -ForegroundColor Yellow

# 7.1 删除会话
if ($script:session_id) {
    Write-Host "删除测试会话..." -ForegroundColor Cyan
    $response = Test-Endpoint -method "DELETE" -endpoint "/api/sessions/$($script:session_id)" -description "删除会话" -token $script:token
}

# 7.2 删除配置
if ($script:config_id) {
    Write-Host "删除测试配置..." -ForegroundColor Cyan
    $response = Test-Endpoint -method "DELETE" -endpoint "/api/config/$($script:config_id)" -description "删除配置" -token $script:token
}

# 7.3 删除用户
if ($script:user_id) {
    Write-Host "删除测试用户..." -ForegroundColor Cyan
    $response = Test-Endpoint -method "DELETE" -endpoint "/api/users/$($script:user_id)" -description "删除用户" -token $script:token
}

Write-Host "`n========================================" -ForegroundColor Blue
Write-Host "测试完成！" -ForegroundColor Blue
Write-Host "========================================`n" -ForegroundColor Blue
