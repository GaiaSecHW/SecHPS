import re

# 读取文件
with open('D:/claude-web-platform/src/components/workflow/WorkflowEditor.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 新的 handleSave 函数
new_handleSave = '''  // 保存Agent编排
  const handleSave = async () => {
    if (!onSave) return;

    try {
      setSaving(true);
      
      // 生成缩略图
      let thumbnail: string | undefined = undefined;
      try {
        console.log('=== 开始生成缩略图 ===');
        
        // 等待 React Flow 渲染完成
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => setTimeout(resolve, 100)); // 额外等待确保渲染完成
        
        // 尝试多个后备选择器
        const flowElement = 
          document.querySelector('.workflow-canvas') ||
          document.querySelector('.react-flow') ||
          document.querySelector('[class*=" react-flow\]') ||
 document.querySelector('.react-flow__viewport');
 
 if (!flowElement) {
 console.error('未找到 React Flow DOM 元素');
 console.log('可用的 DOM 元素:', document.body.innerHTML.substring(0, 500));
 
 // 列出所有可能的元素
 const allFlowElements = document.querySelectorAll('[class*=\flow\]');
 console.log('所有包含 \flow\ 的元素:',:', Array.from(allFlowElements).map(el => el.className));
 
 throw new Error('未找到 React Flow 画布元素');
 }
 
 console.log('找到的元素:', flowElement);
 console.log('元素类名:', flowElement.className);
 console.log('元素尺寸:', flowElement.getBoundingClientRect());
 
 const dataUrl = await toPng(flowElement as HTMLElement, {
 canvasWidth: 800,
 canvasHeight: 600,
 quality: 0.9,
 backgroundColor: '#ffffff',
 style: {
 transform: 'scale(1)',
 transformOrigin: 'top left',
 },
 });
 
 thumbnail = dataUrl.split(',')[1];
 console.log('缩略图生成成功，大小:', thumbnail.length, '字节');
 } catch (error) {
 console.error('生成缩略图失败:', error);
 const errorMessage = error instanceof Error ? error.message : '未知错误';
 alert('缩略图生成失败: ' + errorMessage + '\\n工作流仍会保存，但缩略图可能为空');
 // 不中断保存流程，继续保存但缩略图为空
 }
 
 const data: WorkflowData = {
 nodes,
 edges,
 viewport: undefined,
 thumbnail,
 };
 await onSave(data);
 } catch (error) {
 console.error('Failed to save workflow:', error);
 alert('保存失败');
 throw error;
 } finally {
 setSaving(false);
 }
 };
'''

# 使用正则表达式了替换旧的 handleSave 函数
pattern = r' // 保存Agent编排\n const handleSave = async \(\) => \{.*?^\s+\};\s*\n'
replacement = new_handleSave + '\n\n'

content = re.sub(pattern, replacement, content, flags=re.DOTALL | re.MULTILINE)

# 写回文件
with open('D:/claude-web-platform/src/components/workflow/WorkflowEditor.tsx', 'w', encoding='utf-8') as f:
 f.write(content)

print('文件修改成功')
