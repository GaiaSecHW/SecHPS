import { NextResponse } from 'next/server';
import { listTaskFiles, TaskFileInfo } from '@/lib/minio-vulnerability';

const LOCAL_TEST_VULN_TASK_ID = '70b14e3f-1614-407d-800b-ca2a485c5016';

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