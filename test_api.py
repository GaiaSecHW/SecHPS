#!/usr/bin/env python3
"""
完整的API测试脚本
测试所有主要的API端点
"""

import requests
import json
from datetime import datetime

BASE_URL = "http://localhost:3000"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    END = '\033[0m'

def print_test(endpoint, method, status, success, message=""):
    color = Colors.GREEN if success else Colors.RED
    status_color = Colors.GREEN if status == 200 else Colors.YELLOW if status in [201, 204] else Colors.RED
    print(f"{color}{'✓' if success else '✗'}{Colors.END} {method:6} {endpoint:40} {status_color}{status}{Colors.END} {message}")

def test_api():
    print(f"\n{Colors.BLUE}{'='*80}{Colors.END}")
    print(f"{Colors.BLUE}AI4WEB 测试平台 - API 完整测试{Colors.END}")
    print(f"{Colors.BLUE}{'='*80}{Colors.END}\n")
    
    # 存储测试数据
    test_data = {
        "user_id": None,
        "token": None,
        "role_id": None,
        "permission_id": None,
        "config_id": None,
        "session_id": None
    }
    
    # ==================== 1. 认证API测试 ====================
    print(f"\n{Colors.YELLOW}[1. 认证API测试]{Colors.END}\n")
    
    # 1.1 注册新用户
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    test_user = {
        "email": f"test_{timestamp}@example.com",
        "username": f"testuser_{timestamp}",
        "password": "TestPass123!",
        "name": "Test User"
    }
    
    try:
        response = requests.post(f"{BASE_URL}/api/auth/register", json=test_user)
        success = response.status_code in [200, 201]
        if success:
            data = response.json()
            test_data["user_id"] = data.get("user", {}).get("id")
        print_test("/api/auth/register", "POST", response.status_code, success, 
                   f"用户: {test_user['username']}" if success else response.json().get("error", ""))
    except Exception as e:
        print_test("/api/auth/register", "POST", 0, False, str(e))
    
    # 1.2 登录
    try:
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": test_user["email"],
            "password": test_user["password"]
        })
        success = response.status_code == 200
        if success:
            data = response.json()
            test_data["token"] = data.get("token")
            test_data["user_id"] = data.get("user", {}).get("id")
        print_test("/api/auth/login", "POST", response.status_code, success,
                   "获取token成功" if success else response.json().get("error", ""))
    except Exception as e:
        print_test("/api/auth/login", "POST", 0, False, str(e))
    
    # 设置认证头
    headers = {"Authorization": f"Bearer {test_data['token']}"} if test_data["token"] else {}
    
    # ==================== 2. 用户管理API测试 ====================
    print(f"\n{Colors.YELLOW}[2. 用户管理API测试]{Colors.END}\n")
    
    # 2.1 获取所有用户
    try:
        response = requests.get(f"{BASE_URL}/api/users", headers=headers)
        success = response.status_code == 200
        users_count = len(response.json().get("users", [])) if success else 0
        print_test("/api/users", "GET", response.status_code, success,
                   f"用户数: {users_count}" if success else response.json().get("error", ""))
    except Exception as e:
        print_test("/api/users", "GET", 0, False, str(e))
    
    # 2.2 获取单个用户
    if test_data["user_id"]:
        try:
            response = requests.get(f"{BASE_URL}/api/users/{test_data['user_id']}", headers=headers)
            success = response.status_code == 200
            username = response.json().get("user", {}).get("username", "") if success else ""
            print_test(f"/api/users/{test_data['user_id']}", "GET", response.status_code, success,
                       f"用户名: {username}" if success else response.json().get("error", ""))
        except Exception as e:
            print_test(f"/api/users/{test_data['user_id']}", "GET", 0, False, str(e))
    
    # 2.3 更新用户信息
    if test_data["user_id"]:
        try:
            response = requests.patch(f"{BASE_URL}/api/users/{test_data['user_id']}", 
                                     headers=headers,
                                     json={"name": "Updated Test User"})
            success = response.status_code == 200
            print_test(f"/api/users/{test_data['user_id']}", "PATCH", response.status_code, success,
                       "更新成功" if success else response.json().get("error", ""))
        except Exception as e:
            print_test(f"/api/users/{test_data['user_id']}", "PATCH", 0, False, str(e))
    
    # ==================== 3. 角色管理API测试 ====================
    print(f"\n{Colors.YELLOW}[3. 角色管理API测试]{Colors.END}\n")
    
    # 3.1 获取所有角色
    try:
        response = requests.get(f"{BASE_URL}/api/roles", headers=headers)
        success = response.status_code == 200
        roles_count = len(response.json().get("roles", [])) if success else 0
        print_test("/api/roles", "GET", response.status_code, success,
                   f"角色数: {roles_count}" if success else response.json().get("error", ""))
    except Exception as e:
        print_test("/api/roles", "GET", 0, False, str(e))
    
    # 3.2 创建新角色
    try:
        response = requests.post(f"{BASE_URL}/api/roles", 
                                headers=headers,
                                json={
                                    "name": f"test_role_{timestamp}",
                                    "description": "Test role for API testing"
                                })
        success = response.status_code in [200, 201]
        if success:
            test_data["role_id"] = response.json().get("role", {}).get("id")
        print_test("/api/roles", "POST", response.status_code, success,
                   "创建成功" if success else response.json().get("error", ""))
    except Exception as e:
        print_test("/api/roles", "POST", 0, False, str(e))
    
    # 3.3 为用户分配角色
    if test_data["user_id"] and test_data["role_id"]:
        try:
            response = requests.post(f"{BASE_URL}/api/users/{test_data['user_id']}/roles",
                                    headers=headers,
                                    json={"roleIds": [test_data["role_id"]]})
            success = response.status_code in [200, 201]
            print_test(f"/api/users/{test_data['user_id']}/roles", "POST", response.status_code, success,
                       "分配成功" if success else response.json().get("error", ""))
        except Exception as e:
            print_test(f"/api/users/{test_data['user_id']}/roles", "POST", 0, False, str(e))
    
    # ==================== 4. 权限管理API测试 ====================
    print(f"\n{Colors.YELLOW}[4. 权限管理API测试]{Colors.END}\n")
    
    # 4.1 获取所有权限
    try:
        response = requests.get(f"{BASE_URL}/api/permissions", headers=headers)
        success = response.status_code == 200
        permissions_count = len(response.json().get("permissions", [])) if success else 0
        print_test("/api/permissions", "GET", response.status_code, success,
                   f"权限数: {permissions_count}" if success else response.json().get("error", ""))
    except Exception as e:
        print_test("/api/permissions", "GET", 0, False, str(e))
    
    # 4.2 创建新权限
    try:
        response = requests.post(f"{BASE_URL}/api/permissions",
                                headers=headers,
                                json={
                                    "name": f"test:permission_{timestamp}",
                                    "module": "test",
                                    "action": "test",
                                    "resource": "test_resource"
                                })
        success = response.status_code in [200, 201]
        if success:
            test_data["permission_id"] = response.json().get("permission", {}).get("id")
        print_test("/api/permissions", "POST", response.status_code, success,
                   "创建成功" if success else response.json().get("error", ""))
    except Exception as e:
        print_test("/api/permissions", "POST", 0, False, str(e))
    
    # ==================== 5. 配置管理API测试 ====================
    print(f"\n{Colors.YELLOW}[5. 配置管理API测试]{Colors.END}\n")
    
    # 5.1 获取配置列表
    try:
        response = requests.get(f"{BASE_URL}/api/config", headers=headers)
        success = response.status_code == 200
        configs_count = len(response.json().get("configs", [])) if success else 0
        print_test("/api/config", "GET", response.status_code, success,
                   f"配置数: {configs_count}" if success else response.json().get("error", ""))
    except Exception as e:
        print_test("/api/config", "GET", 0, False, str(e))
    
    # 5.2 创建新配置
    try:
        response = requests.post(f"{BASE_URL}/api/config",
                                headers=headers,
                                json={
                                    "name": f"Test Config {timestamp}",
                                    "baseURL": "http://localhost:54321",
                                    "description": "Test configuration",
                                    "isActive": True,
                                    "mcpServers": json.dumps([
                                        {"name": "filesystem", "type": "local"}
                                    ]),
                                    "keybinds": json.dumps({"save": "Ctrl+S"}),
                                    "modelPreferences": json.dumps({"openai": {"model": "gpt-4"}})
                                })
        success = response.status_code in [200, 201]
        if success:
            test_data["config_id"] = response.json().get("config", {}).get("id")
        print_test("/api/config", "POST", response.status_code, success,
                   "创建成功" if success else response.json().get("error", ""))
    except Exception as e:
        print_test("/api/config", "POST", 0, False, str(e))
    
    # 5.3 更新配置
    if test_data["config_id"]:
        try:
            response = requests.patch(f"{BASE_URL}/api/config/{test_data['config_id']}",
                                     headers=headers,
                                     json={"description": "Updated test configuration"})
            success = response.status_code == 200
            print_test(f"/api/config/{test_data['config_id']}", "PATCH", response.status_code, success,
                       "更新成功" if success else response.json().get("error", ""))
        except Exception as e:
            print_test(f"/api/config/{test_data['config_id']}", "PATCH", 0, False, str(e))
    
    # ==================== 6. 会话管理API测试 ====================
    print(f"\n{Colors.YELLOW}[6. 会话管理API测试]{Colors.END}\n")
    
    # 6.1 获取会话列表
    try:
        response = requests.get(f"{BASE_URL}/api/sessions", headers=headers)
        success = response.status_code == 200
        sessions_count = len(response.json().get("sessions", [])) if success else 0
        print_test("/api/sessions", "GET", response.status_code, success,
                   f"会话数: {sessions_count}" if success else response.json().get("error", ""))
    except Exception as e:
        print_test("/api/sessions", "GET", 0, False, str(e))
    
    # 6.2 创建新会话
    try:
        response = requests.post(f"{BASE_URL}/api/sessions",
                                headers=headers,
                                json={
                                    "title": f"Test Session {timestamp}",
                                    "configId": test_data.get("config_id")
                                })
        success = response.status_code in [200, 201]
        if success:
            test_data["session_id"] = response.json().get("session", {}).get("id")
        print_test("/api/sessions", "POST", response.status_code, success,
                   "创建成功" if success else response.json().get("error", ""))
    except Exception as e:
        print_test("/api/sessions", "POST", 0, False, str(e))
    
    # 6.3 获取会话详情
    if test_data["session_id"]:
        try:
            response = requests.get(f"{BASE_URL}/api/sessions/{test_data['session_id']}", headers=headers)
            success = response.status_code == 200
            title = response.json().get("session", {}).get("title", "") if success else ""
            print_test(f"/api/sessions/{test_data['session_id']}", "GET", response.status_code, success,
                       f"标题: {title}" if success else response.json().get("error", ""))
        except Exception as e:
            print_test(f"/api/sessions/{test_data['session_id']}", "GET", 0, False, str(e))
    
    # ==================== 7. 清理测试数据 ====================
    print(f"\n{Colors.YELLOW}[7. 清理测试数据]{Colors.END}\n")
    
    # 7.1 删除会话
    if test_data["session_id"]:
        try:
            response = requests.delete(f"{BASE_URL}/api/sessions/{test_data['session_id']}", headers=headers)
            success = response.status_code in [200, 204]
            print_test(f"/api/sessions/{test_data['session_id']}", "DELETE", response.status_code, success,
                       "删除成功" if success else response.json().get("error", ""))
        except Exception as e:
            print_test(f"/api/sessions/{test_data['session_id']}", "DELETE", 0, False, str(e))
    
    # 7.2 删除配置
    if test_data["config_id"]:
        try:
            response = requests.delete(f"{BASE_URL}/api/config/{test_data['config_id']}", headers=headers)
            success = response.status_code in [200, 204]
            print_test(f"/api/config/{test_data['config_id']}", "DELETE", response.status_code, success,
                       "删除成功" if success else response.json().get("error", ""))
        except Exception as e:
            print_test(f"/api/config/{test_data['config_id']}", "DELETE", 0, False, str(e))
    
    # 7.3 删除用户
    if test_data["user_id"]:
        try:
            response = requests.delete(f"{BASE_URL}/api/users/{test_data['user_id']}", headers=headers)
            success = response.status_code in [200, 204]
            print_test(f"/api/users/{test_data['user_id']}", "DELETE", response.status_code, success,
                       "删除成功" if success else response.json().get("error", ""))
        except Exception as e:
            print_test(f"/api/users/{test_data['user_id']}", "DELETE", 0, False, str(e))
    
    print(f"\n{Colors.BLUE}{'='*80}{Colors.END}")
    print(f"{Colors.BLUE}测试完成！{Colors.END}")
    print(f"{Colors.BLUE}{'='*80}{Colors.END}\n")

if __name__ == "__main__":
    test_api()
