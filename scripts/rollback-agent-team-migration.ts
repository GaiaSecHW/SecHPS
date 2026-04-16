#!/usr/bin/env ts-node
/**
 * AgentTeam Migration Rollback Script
 * 
 * Reverses the Workflow → AgentTeam migration by:
 * - Deleting all created AgentTeams and AgentTeamMembers
 * - Restoring EvaluationSession.workflowId references
 * - Optionally deleting the placeholder AgentDefinition
 * 
 * Usage:
 * npm run rollback:agent-team
 * or
 * npx tsx scripts/rollback-agent-team-migration.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Migration log file path
const MIGRATION_LOG_FILE = 'migration-workflow-to-agent-team-log.json';
const PLACEHOLDER_AGENT_ID = 'migrated-workflow-placeholder-agent';

interface MigrationLog {
  timestamp: string;
  placeholderAgentId: string;
  workflows: {
    workflowId: string;
    agentTeamId: string;
    nodes: {
      nodeId: string;
      memberId: string;
      nodeName: string;
      nodeType: string;
    }[];
    edges: {
      edgeId: string;
      sourceNodeId: string;
      targetNodeId: string;
      sourceMemberId: string;
      targetMemberId: string;
    }[];
    evaluationSessionIds: string[];
  }[];
  stats: {
    workflowsProcessed: number;
    teamsCreated: number;
    membersCreated: number;
    edgesMapped: number;
    sessionsUpdated: number;
    errors: string[];
  };
}

interface RollbackResult {
  timestamp: string;
  teamsDeleted: number;
  membersDeleted: number;
  sessionsRestored: number;
  placeholderDeleted: boolean;
  errors: string[];
}

/**
 * Read migration log file
 */
function readMigrationLog(): MigrationLog | null {
  const logPath = path.join(process.cwd(), MIGRATION_LOG_FILE);
  
  if (!fs.existsSync(logPath)) {
    console.error(`Migration log file not found: ${logPath}`);
    console.error('Cannot rollback without migration log.');
    return null;
  }
  
  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    return JSON.parse(content) as MigrationLog;
  } catch (error) {
    console.error(`Failed to read migration log: ${error}`);
    return null;
  }
}

/**
 * Main rollback function
 */
async function rollback(): Promise<RollbackResult> {
  console.log('========================================');
  console.log('AgentTeam Migration Rollback Script');
  console.log('========================================\n');
  
  const result: RollbackResult = {
    timestamp: new Date().toISOString(),
    teamsDeleted: 0,
    membersDeleted: 0,
    sessionsRestored: 0,
    placeholderDeleted: false,
    errors: [],
  };
  
  try {
    // 1. Read migration log
    console.log('Reading migration log...');
    const log = readMigrationLog();
    
    if (!log) {
      console.error('Rollback aborted: No migration log found.');
      result.errors.push('No migration log found');
      return result;
    }
    
    console.log(`Migration was performed at: ${log.timestamp}`);
    console.log(`Workflows to rollback: ${log.workflows.length}\n`);
    
    if (log.workflows.length === 0) {
      console.log('No migrated workflows to rollback.');
      return result;
    }
    
    // 2. Restore EvaluationSession.workflowId references
    console.log('Restoring EvaluationSession workflowId references...');
    for (const workflow of log.workflows) {
      if (workflow.evaluationSessionIds.length > 0) {
        try {
          await prisma.evaluationSession.updateMany({
            where: { id: { in: workflow.evaluationSessionIds } },
            data: { workflowId: workflow.workflowId },
          });
          result.sessionsRestored += workflow.evaluationSessionIds.length;
          console.log(`  Restored ${workflow.evaluationSessionIds.length} sessions for workflow ${workflow.workflowId}`);
        } catch (error) {
          const errorMsg = `Failed to restore sessions for workflow ${workflow.workflowId}: ${error}`;
          console.error(`  ✗ ${errorMsg}`);
          result.errors.push(errorMsg);
        }
      }
    }
    
    // 3. Delete AgentTeamMembers (must delete before AgentTeams due to foreign key)
    console.log('\nDeleting AgentTeamMembers...');
    for (const workflow of log.workflows) {
      const memberIds = workflow.nodes.map(n => n.memberId);
      
      if (memberIds.length > 0) {
        try {
          const deleted = await prisma.agentTeamMember.deleteMany({
            where: { id: { in: memberIds } },
          });
          result.membersDeleted += deleted.count;
          console.log(`  Deleted ${deleted.count} members for team ${workflow.agentTeamId}`);
        } catch (error) {
          const errorMsg = `Failed to delete members for team ${workflow.agentTeamId}: ${error}`;
          console.error(`  ✗ ${errorMsg}`);
          result.errors.push(errorMsg);
        }
      }
    }
    
    // 4. Delete AgentTeams
    console.log('\nDeleting AgentTeams...');
    const teamIds = log.workflows.map(w => w.agentTeamId);
    
    if (teamIds.length > 0) {
      try {
        const deleted = await prisma.agentTeam.deleteMany({
          where: { id: { in: teamIds } },
        });
        result.teamsDeleted = deleted.count;
        console.log(`Deleted ${deleted.count} AgentTeams`);
      } catch (error) {
        const errorMsg = `Failed to delete AgentTeams: ${error}`;
        console.error(`✗ ${errorMsg}`);
        result.errors.push(errorMsg);
      }
    }
    
    // 5. Delete placeholder AgentDefinition (optional)
    console.log('\nDeleting placeholder AgentDefinition...');
    try {
      const deleted = await prisma.agentDefinition.delete({
        where: { id: PLACEHOLDER_AGENT_ID },
      });
      result.placeholderDeleted = true;
      console.log(`Deleted placeholder agent: ${deleted.id}`);
    } catch (error: any) {
      if (error.code === 'P2025') {
        console.log('Placeholder agent already deleted or not found.');
        result.placeholderDeleted = true;
      } else {
        const errorMsg = `Failed to delete placeholder agent: ${error}`;
        console.error(`✗ ${errorMsg}`);
        result.errors.push(errorMsg);
      }
    }
    
    // 6. Delete migration log file
    const logPath = path.join(process.cwd(), MIGRATION_LOG_FILE);
    if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath);
      console.log(`\nDeleted migration log file: ${logPath}`);
    }
    
    // 7. Output summary
    console.log('\n========================================');
    console.log('Rollback Summary');
    console.log('========================================');
    console.log(`AgentTeams deleted: ${result.teamsDeleted}`);
    console.log(`AgentTeamMembers deleted: ${result.membersDeleted}`);
    console.log(`EvaluationSessions restored: ${result.sessionsRestored}`);
    console.log(`Placeholder agent deleted: ${result.placeholderDeleted}`);
    
    if (result.errors.length > 0) {
      console.log(`\nErrors (${result.errors.length}):`);
      result.errors.forEach(err => console.log(`  - ${err}`));
    }
    
    console.log('\n✓ Rollback completed. Original Workflow data is intact.');
    
    return result;
    
  } catch (error) {
    console.error('\nRollback failed:', error);
    result.errors.push(`Rollback failed: ${error}`);
    throw error;
  }
}

/**
 * Entry point
 */
async function main() {
  try {
    await rollback();
  } catch (error) {
    console.error('Rollback script failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();