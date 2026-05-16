import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const record = await prisma.localTestRecord.findUnique({
      where: { taskId },
    });

    if (!record) {
      return NextResponse.json({ error: '记录不存在' }, { status: 404 });
    }

    if (!record.uploadedFilePath) {
      return NextResponse.json({ error: '该任务没有上传的报告文件' }, { status: 404 });
    }

    if (!fs.existsSync(record.uploadedFilePath)) {
      return NextResponse.json({ error: '报告文件不存在' }, { status: 404 });
    }

    const fileContent = fs.readFileSync(record.uploadedFilePath);
    const fileName = path.basename(record.uploadedFilePath);

    return new NextResponse(fileContent, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': fileContent.length.toString(),
      },
    });
  } catch (error) {
    console.error('[DownloadReport] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}