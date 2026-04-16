#!/usr/bin/env ts-node
/**
 * Workflow → AgentTeam Migration Script
 * 
 * Migrates existing Workflow data to the new AgentTeam structure.
 * Preserves original Workflow data (no deletion).
 * 
 * Usage:
 * npm run migrate:workflow-to-agent-team
 * or
 * npx tsx scripts/migrate-workflow-to-agent-team.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Placeholder AgentDefinition ID for migration
const PLACEHOLDER_AGENT_ID = 'migrated-workflow-placeholder-agent';
const PLACEHOLDER_AGENT_NAME = 'Migrated Workflow Placeholder';

// Migration log file path
const MIGRATION_LOG_FILE = 'migration-workflow-to-agent-team-log.json';

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

/**
 * Ensure placeholder AgentDefinition exists
 */
async function ensurePlaceholderAgent(): Promise<string> {
  console.log('Checking for placeholder AgentDefinition...');
  
  // Check if placeholder already exists
  const existing = await prisma.agentDefinition.findUnique({
    where: { id: PLACEHOLDER_AGENT_ID },
  });
  
  if (existing) {
    console.log(`Placeholder AgentDefinition already exists: ${PLACEHOLDER_AGENT_ID}`);
    return PLACEHOLDER_AGENT_ID;
  }
  
  // Get first admin user for the placeholder
  let admin = await prisma.user.findFirst({
    where: {
      userRoles: {
        some: {
          role: {
            name: 'admin',
          },
        },
      },
    },
  });
  
  if (!admin) {
    admin = await prisma.user.findFirst();
    if (!admin) {
      throw new Error('No user found in database. Cannot create placeholder AgentDefinition.');
    }
  }
  
  // Create placeholder AgentDefinition
  const placeholder = await prisma.agentDefinition.create({
    data: {
      id: PLACEHOLDER_AGENT_ID,
      userId: admin.id,
      name: PLACEHOLDER_AGENT_NAME,
      displayName: 'Migrated Workflow Placeholder Agent',
      description: 'Placeholder agent created during Workflow → AgentTeam migration. Replace with actual agent configuration.',
      category: 'migration',
      model: 'placeholder',
      isActive: false,
      isBuiltin: false,
      updatedAt: new Date(),
    },
  });
  
  console.log(`Created placeholder AgentDefinition: ${placeholder.id}`);
  return placeholder.id;
}

/**
 * Map workflow status to agent team status
 */
function mapWorkflowStatus(workflowStatus: string): string {
  switch (workflowStatus) {
    case 'running':
      return 'running';
    case 'draft':
    case 'inactive':
      return 'idle';
    case 'completed':
      return 'completed';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

/**
 * Map workflow node type to member role
 */
function mapNodeTypeToRole(nodeType: string): string {
  switch (nodeType) {
    case 'start':
      return 'lead';
    case 'end':
      return 'observer';
    case 'condition':
      return 'coordinator';
    case 'action':
    case 'skill':
    case 'agent':
      return 'worker';
    default:
      return 'teammate';
  }
}

/**
 * Main migration function
 */
async function migrate(): Promise<MigrationLog> {
  console.log('========================================');
  console.log('Workflow → AgentTeam Migration Script');
  console.log('========================================\n');
  
  const migrationLog: MigrationLog = {
    timestamp: new Date().toISOString(),
    placeholderAgentId: PLACEHOLDER_AGENT_ID,
    workflows: [],
    stats: {
      workflowsProcessed: 0,
      teamsCreated: 0,
      membersCreated: 0,
      edgesMapped: 0,
      sessionsUpdated: 0,
      errors: [],
    },
  };
  
  try {
    // 1. Ensure placeholder agent exists
    const placeholderAgentId = await ensurePlaceholderAgent();
    
    // 2. Fetch all workflows with nodes and edges
    console.log('\nFetching workflows...');
    const workflows = await prisma.workflow.findMany({
      include: {
        nodes: {
          orderBy: { createdAt: 'asc' },
        },
        edges: true,
        EvaluationSession: true,
      },
    });
    
    console.log(`Found ${workflows.length} workflows to migrate\n`);
    
    if (workflows.length === 0) {
      console.log('No workflows to migrate.');
      return migrationLog;
    }
    
    // 3. Process each workflow
    for (const workflow of workflows) {
      console.log(`\nProcessing workflow: ${workflow.name} (${workflow.id})`);
      console.log(`  Nodes: ${workflow.nodes.length}, Edges: ${workflow.edges.length}`);
      
      try {
        // Create AgentTeam
        const firstNode = workflow.nodes[0];
        const team = await prisma.agentTeam.create({
          data: {
            id: `migrated-team-${workflow.id}`,
            userId: workflow.userId,
            name: workflow.name,
            description: workflow.description || `Migrated from workflow: ${workflow.name}`,
            leadAgentId: placeholderAgentId,
            taskStrategy: 'sequential', // Default for migrated workflows
            maxTeammates: workflow.nodes.length || 5,
            status: mapWorkflowStatus(workflow.status),
            updatedAt: new Date(),
          },
        });
        
        console.log(`  Created AgentTeam: ${team.id}`);
        migrationLog.stats.teamsCreated++;
        
        // Create node-to-member mapping
        const nodeToMemberMap: Map<string, string> = new Map();
        const nodeMembers: MigrationLog['workflows'][0]['nodes'] = [];
        
        // Create AgentTeamMember for each node
        for (const node of workflow.nodes) {
          // Parse node data if it's JSON
          let nodeData: any = {};
          try {
            nodeData = node.data ? JSON.parse(node.data) : {};
          } catch {
            nodeData = { raw: node.data };
          }
          
          const member = await prisma.agentTeamMember.create({
            data: {
              id: `migrated-member-${node.id}`,
              teamId: team.id,
              agentId: placeholderAgentId,
              role: mapNodeTypeToRole(node.type),
              overrideModel: nodeData.model || null,
              overrideTools: JSON.stringify({
                originalNodeId: node.id,
                originalNodeType: node.type,
                originalNodeName: nodeData.label || nodeData.name || `Node ${node.id}`,
                originalNodeData: nodeData,
                position: { x: node.positionX, y: node.positionY },
              }),
            },
          });
          
          nodeToMemberMap.set(node.id, member.id);
          nodeMembers.push({
            nodeId: node.id,
            memberId: member.id,
            nodeName: nodeData.label || nodeData.name || `Node ${node.id}`,
            nodeType: node.type,
          });
          
          migrationLog.stats.membersCreated++;
        }
        
        console.log(`  Created ${workflow.nodes.length} AgentTeamMembers`);
        
        // Map edges to dependencies
        const edgeMappings: MigrationLog['workflows'][0]['edges'] = [];
        for (const edge of workflow.edges) {
          const sourceMemberId = nodeToMemberMap.get(edge.sourceId);
          const targetMemberId = nodeToMemberMap.get(edge.targetId);
          
          if (sourceMemberId && targetMemberId) {
            edgeMappings.push({
              edgeId: edge.id,
              sourceNodeId: edge.sourceId,
              targetNodeId: edge.targetId,
              sourceMemberId,
              targetMemberId,
            });
            migrationLog.stats.edgesMapped++;
          } else {
            const error = `Edge ${edge.id} has missing node reference: source=${edge.sourceId}, target=${edge.targetId}`;
            console.log(`  Warning: ${error}`);
            migrationLog.stats.errors.push(error);
          }
        }
        
        // Update EvaluationSessions to null workflowId (preserve column)
        const sessionIds = workflow.EvaluationSession.map(s => s.id);
        if (sessionIds.length > 0) {
          await prisma.evaluationSession.updateMany({
            where: { workflowId: workflow.id },
            data: { workflowId: null },
          });
          console.log(`  Updated ${sessionIds.length} EvaluationSessions (workflowId → null)`);
          migrationLog.stats.sessionsUpdated += sessionIds.length;
        }
        
        // Record in migration log
        migrationLog.workflows.push({
          workflowId: workflow.id,
          agentTeamId: team.id,
          nodes: nodeMembers,
          edges: edgeMappings,
          evaluationSessionIds: sessionIds,
        });
        
        migrationLog.stats.workflowsProcessed++;
        console.log(`  ✓ Workflow migrated successfully`);
        
      } catch (error) {
        const errorMsg = `Failed to migrate workflow ${workflow.id}: ${error}`;
        console.error(`  ✗ ${errorMsg}`);
        migrationLog.stats.errors.push(errorMsg);
      }
    }
    
    // 4. Save migration log to file
    const logPath = path.join(process.cwd(), MIGRATION_LOG_FILE);
    fs.writeFileSync(logPath, JSON.stringify(migrationLog, null, 2), 'utf-8');
    console.log(`\nMigration log saved to: ${logPath}`);
    
    // 5. Output summary
    console.log('\n========================================');
    console.log('Migration Summary');
    console.log('========================================');
    console.log(`Workflows processed: ${migrationLog.stats.workflowsProcessed}`);
    console.log(`AgentTeams created: ${migrationLog.stats.teamsCreated}`);
    console.log(`AgentTeamMembers created: ${migrationLog.stats.membersCreated}`);
    console.log(`Edges mapped: ${migrationLog.stats.edgesMapped}`);
    console.log(`EvaluationSessions updated: ${migrationLog.stats.sessionsUpdated}`);
    
    if (migrationLog.stats.errors.length > 0) {
      console.log(`\nErrors (${migrationLog.stats.errors.length}):`);
      migrationLog.stats.errors.forEach(err => console.log(`  - ${err}`));
    }
    
    console.log('\n⚠️  IMPORTANT: Original Workflow data has been preserved.');
    console.log('⚠️  Placeholder agents need to be replaced with actual AgentDefinitions.');
    console.log('⚠️  Use rollback script if needed: npm run rollback:agent-team');
    
    return migrationLog;
    
  } catch (error) {
    console.error('\nMigration failed:', error);
    migrationLog.stats.errors.push(`Migration failed: ${error}`);
    
    // Save error log
    const logPath = path.join(process.cwd(), MIGRATION_LOG_FILE);
    fs.writeFileSync(logPath, JSON.stringify(migrationLog, null, 2), 'utf-8');
    
    throw error;
  }
}

/**
 * Entry point
 */
async function main() {
  try {
    await migrate();
  } catch (error) {
    console.error('Migration script failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();