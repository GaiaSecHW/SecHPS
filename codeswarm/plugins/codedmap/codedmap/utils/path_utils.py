from pathlib import Path
import os
from typing import Optional


def normalize_path(raw_path: str, project_root: Optional[str] = None, include_project_name: bool = False) -> str:
    """
    路径标准化工具。

    Args:
        raw_path: 原始路径 (可能是绝对路径，也可能是相对路径)
        project_root: 项目根目录 (绝对路径)
        include_project_name:
            - True:  返回 "ProjectName/src/main.c" (适用于全局唯一ID构建)
            - False: 返回 "src/main.c" (适用于 CallGraph 匹配，编译器通常只输出这一段)

    Returns:
        标准化后的 POSIX 路径字符串
    """
    if not raw_path:
        return ""

    # 如果 raw_path 已经是相对路径，且我们不需要 project_root 参与计算
    # (或者 raw_path 看起来已经是一个干净的相对路径)
    path_obj = Path(raw_path)
    if not path_obj.is_absolute() and not project_root:
        return path_obj.as_posix()

    # 如果没有提供 project_root，尝试回退到当前工作目录，或者直接返回原路径
    if not project_root:
        # 策略：如果没有 root，且是绝对路径，我们很难去头。
        # 这里可以选择返回原样，或者尝试相对于 cwd
        try:
            return path_obj.relative_to(Path.cwd()).as_posix()
        except ValueError:
            return path_obj.as_posix()

    # 有 project_root 的核心逻辑
    root_obj = Path(project_root)

    try:
        # 1. 统一转绝对路径进行计算 (处理 ../ 等情况)
        # 注意：resolve() 在某些系统上要求文件必须存在，如果分析的是离线代码，
        # 建议改用 os.path.abspath 或 path.absolute()
        abs_path = path_obj.absolute() if not path_obj.is_absolute() else path_obj
        abs_root = root_obj.absolute() if not root_obj.is_absolute() else root_obj

        # 2. 计算相对路径 (e.g. /mnt/d/linux/drivers/tee.c -> drivers/tee.c)
        rel_path = abs_path.relative_to(abs_root)

        # 3. 根据参数决定是否拼接项目名
        if include_project_name:
            # 结果: linux-6.18.2/drivers/tee.c
            final_path = root_obj.name / rel_path
        else:
            # 结果: drivers/tee.c
            final_path = rel_path

        return final_path.as_posix()

    except ValueError:
        # 路径不在 root 下 (比如引用了 /usr/include)
        # 这种情况下，保持原样或仅返回文件名
        return path_obj.as_posix()