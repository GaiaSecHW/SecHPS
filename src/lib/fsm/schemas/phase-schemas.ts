/**
 * FSM 阶段输出 Zod Schema 定义
 */
import { z } from 'zod';

// ============================================
// P1: Project Understanding Schema
// ============================================

export const P1ProjectContextSchema = z.object({
  project_type: z.string(),
  tech_stack: z.array(z.string()),
});

export const P1ModuleSchema = z.object({
  id: z.string().regex(/^M-\d{3}$/),
  name: z.string(),
  path: z.string(),
  security_level: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  type: z.string().optional(),
});

export const P1EntryPointSchema = z.object({
  id: z.string().regex(/^EP-[A-Z]+-\d{3}$/),
  name: z.string(),
  type: z.enum(['API', 'UI', 'CLI', 'WebSocket', 'gRPC', 'config', 'file']),
  path: z.string(),
  auth_required: z.boolean(),
});

export const P1DiscoveryChecklistSchema = z.object({
  checklist: z.record(z.string(), z.object({
    scanned: z.literal(true),
    count: z.number().optional(),
  })),
});

export const P1OutputSchema = z.object({
  project_context: P1ProjectContextSchema,
  module_inventory: z.object({
    modules: z.array(P1ModuleSchema),
  }),
  entry_point_inventory: z.object({
    entry_points: z.array(P1EntryPointSchema),
  }),
  discovery_checklist: P1DiscoveryChecklistSchema,
});

// ============================================
// P2: DFD Analysis Schema
// ============================================

export const P2InterfaceSchema = z.object({
  id: z.string().regex(/^IF-\d{3}$/),
  name: z.string(),
  type: z.string(),
  layer: z.enum(['L1', 'L2', 'L3']),
});

export const P2DataFlowSchema = z.object({
  id: z.string().regex(/^DF-\d{3}$/),
  source: z.string(),
  target: z.string(),
  data_type: z.string(),
  sensitivity: z.enum(['HIGH', 'MEDIUM', 'LOW', 'NONE']),
});

export const P2ProcessSchema = z.object({
  id: z.string().regex(/^P-\d{3}$/),
  name: z.string(),
  description: z.string().optional(),
});

export const P2DataStoreSchema = z.object({
  id: z.string().regex(/^DS-\d{3}$/),
  name: z.string(),
  type: z.string(),
  sensitivity: z.enum(['HIGH', 'MEDIUM', 'LOW', 'NONE']),
});

export const P2ExternalInteractorSchema = z.object({
  id: z.string().regex(/^EI-\d{3}$/),
  name: z.string(),
  type: z.string(),
});

export const P2DFDElementsSchema = z.object({
  external_interactors: z.array(P2ExternalInteractorSchema),
  processes: z.array(P2ProcessSchema),
  data_stores: z.array(P2DataStoreSchema),
  data_flows: z.array(P2DataFlowSchema),
});

export const P2L1CoverageSchema = z.object({
  coverage_percentage: z.number().min(100).max(100), // 必须 100%
});

export const P2OutputSchema = z.object({
  interface_inventory: z.object({
    interfaces: z.array(P2InterfaceSchema),
  }),
  data_flow_traces: z.object({
    data_flows: z.array(P2DataFlowSchema),
  }),
  dfd_elements: P2DFDElementsSchema,
  l1_coverage: P2L1CoverageSchema,
});

// ============================================
// P3: Trust Boundary Schema
// ============================================

export const P3BoundarySchema = z.object({
  id: z.string().regex(/^TB-\d{3}$/),
  name: z.string(),
  type: z.enum(['Network', 'Process', 'User', 'Data', 'Service', 'Model', 'Agent']),
  description: z.string().optional(),
  elements: z.array(z.string()),
});

export const P3CrossBoundaryFlowSchema = z.object({
  flow_id: z.string(),
  source_boundary: z.string(),
  target_boundary: z.string(),
  data_type: z.string(),
});

export const P3OutputSchema = z.object({
  boundaries: z.array(P3BoundarySchema),
  cross_boundary_flows: z.array(P3CrossBoundaryFlowSchema).optional(),
});

// ============================================
// P4: Security Design Review Schema
// ============================================

export const P4GapSchema = z.object({
  id: z.string().regex(/^GAP-\d{3}$/),
  domain: z.string(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  description: z.string(),
  recommendation: z.string().optional(),
});

export const P4DesignMatrixSchema = z.record(z.string(), z.object({
  score: z.number().min(0).max(100),
  assessed: z.boolean(),
  gaps: z.array(z.string()).optional(),
}));

export const P4OutputSchema = z.object({
  gaps: z.array(P4GapSchema),
  design_matrix: P4DesignMatrixSchema,
  summary: z.object({
    total_gaps: z.number(),
    by_severity: z.object({
      critical: z.number(),
      high: z.number(),
      medium: z.number(),
      low: z.number(),
    }),
  }),
});

// ============================================
// P5: STRIDE Analysis Schema
// ============================================

export const P5ThreatSchema = z.object({
  id: z.string().regex(/^T-[STRIDE]-[A-Z]+-\d{3}-\d{3}$/),
  stride_category: z.enum(['S', 'T', 'R', 'I', 'D', 'E']),
  element_id: z.string(),
  title: z.string(),
  description: z.string(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  cwe: z.string().optional(),
});

export const P5SummarySchema = z.object({
  total: z.number(),
  by_stride: z.object({
    S: z.number(),
    T: z.number(),
    R: z.number(),
    I: z.number(),
    D: z.number(),
    E: z.number(),
  }),
  by_priority: z.object({
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
  }),
});

export const P5OutputSchema = z.object({
  threats: z.array(P5ThreatSchema),
  summary: P5SummarySchema,
  element_coverage_verification: z.object({
    coverage_percentage: z.number().min(80), // 至少 80%
  }),
});

// ============================================
// P6: Risk Validation Schema
// ============================================

export const P6RiskDetailSchema = z.object({
  id: z.string().regex(/^VR-\d{3}$/),
  title: z.string(),
  status: z.enum(['verified', 'theoretical', 'pending', 'excluded']),
  cvss_score: z.number().min(0).max(10),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  threat_refs: z.array(z.string()),
  findings_refs: z.array(z.string()).optional(),
});

export const P6POCSchema = z.object({
  id: z.string().regex(/^POC-\d{3}$/),
  risk_ref: z.string().regex(/^VR-\d{3}$/),
  status: z.enum(['verified', 'pending', 'failed']),
  difficulty: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  code: z.string().optional(),
  execution_steps: z.array(z.string()).optional(),
});

export const P6RiskSummarySchema = z.object({
  verified: z.number(),
  theoretical: z.number(),
  pending: z.number(),
  excluded: z.number(),
  total: z.number(),
});

// 计数守恒验证
export const P6CountConservationSchema = z.object({
  // P5.threat_count = verified + theoretical + pending + excluded
  p5_threat_count: z.number(),
  risk_sum: z.number(),
  conservation_valid: z.literal(true),
});

export const P6OutputSchema = z.object({
  risk_summary: P6RiskSummarySchema,
  risk_details: z.array(P6RiskDetailSchema),
  poc_details: z.array(P6POCSchema).optional(),
  count_conservation: P6CountConservationSchema.optional(),
});

// ============================================
// P7: Mitigation Planning Schema
// ============================================

export const P7MitigationSchema = z.object({
  id: z.string().regex(/^MIT-\d{3}$/),
  title: z.string(),
  risk_refs: z.array(z.string().regex(/^VR-\d{3}$/)),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  effort: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  implementation_steps: z.array(z.object({
    step: z.number(),
    action: z.string(),
    file: z.string().optional(),
    line: z.number().optional(),
    before: z.string().optional(),
    after: z.string().optional(),
  })),
  verification: z.object({
    test_cases: z.array(z.string()).optional(),
    asvs_requirement: z.string().optional(),
  }),
});

export const P7RoadmapSchema = z.object({
  immediate: z.array(z.string()),
  short_term: z.array(z.string()),
  medium_term: z.array(z.string()),
  long_term: z.array(z.string()),
});

export const P7OutputSchema = z.object({
  mitigations: z.array(P7MitigationSchema),
  roadmap: P7RoadmapSchema,
});

// ============================================
// 组合 Schema (Phase 1+2, 3+4, 5+6, 7+8)
// ============================================

export const Phase1OutputSchema = z.object({
  P1: P1OutputSchema,
  P2: P2OutputSchema,
});

export const Phase2OutputSchema = z.object({
  P3: P3OutputSchema,
  P4: P4OutputSchema,
});

export const Phase3OutputSchema = z.object({
  P5: P5OutputSchema,
  P6: P6OutputSchema,
});

export const Phase4OutputSchema = z.object({
  P7: P7OutputSchema,
});

// ============================================
// 导出所有 Schema
// ============================================

export const PhaseSchemas: Record<number, typeof Phase1OutputSchema | typeof Phase2OutputSchema | typeof Phase3OutputSchema | typeof Phase4OutputSchema> = {
  1: Phase1OutputSchema,
  2: Phase2OutputSchema,
  3: Phase3OutputSchema,
  4: Phase4OutputSchema,
};