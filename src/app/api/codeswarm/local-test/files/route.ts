import { NextResponse } from 'next/server';
import { listTaskFiles, TaskFileInfo } from '@/lib/minio-vulnerability';

const LOCAL_TEST_VULN_TASK_ID = '3fa14423-8485-4596-ab8f-c6bd9875fd77';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const effectiveTaskId = taskId === 'default' ? LOCAL_TEST_VULN_TASK_ID : taskId;

    const files = await listTaskFiles(effectiveTaskId);

    const reportFiles: TaskFileInfo[] = [];
    const rawReportFiles: TaskFileInfo[] = [];

    for (const file of files) {
      if (file.category === 'report') {
        reportFiles.push(file);
      } else if (file.category === 'raw') {
        rawReportFiles.push(file);
      }
    }

    return NextResponse.json({
      taskId: effectiveTaskId,
      reportFiles,
      rawReportFiles,
      totalFiles: files.length,
    });
  } catch (error) {
    console.error('[LocalTestFiles] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}