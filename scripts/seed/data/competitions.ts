// Fictional; transcribed from the web mock
import type { SeedCompetition } from '@scripts/seed/seed-data.schema.js';

export const COMPETITIONS = [
  { id: 'comp-crown-league', kind: 'league', name: 'Crown League' },
  { id: 'comp-liga-meridiana', kind: 'league', name: 'Liga Meridiana' },
  {
    id: 'comp-continental-cup',
    kind: 'ucl',
    name: 'Continental Champions Cup',
  },
  { id: 'comp-federation-trophy', kind: 'uel', name: 'Federation Trophy' },
  { id: 'comp-nations-cup', kind: 'world_cup', name: 'Global Nations Cup' },
  {
    id: 'comp-nations-championship',
    kind: 'euro',
    name: 'Continental Nations Championship',
  },
] satisfies SeedCompetition[];
