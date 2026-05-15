export interface ExpertCategory {
  id: string;
  labelKey: string;
  icon: string;
  disabled?: boolean;
}

export const expertCategories: ExpertCategory[] = [
  { id: 'all',               labelKey: 'categoryAll',          icon: '✦'  },
  { id: 'product-design',    labelKey: 'categoryProductDesign', icon: '🎨' },
  { id: 'tech-engineering',  labelKey: 'categoryTechEng',       icon: '💻' },
  { id: 'data-intelligence', labelKey: 'categoryDataIntel',     icon: '📊' },
  { id: 'content-creation',  labelKey: 'categoryContent',       icon: '✍️' },
  { id: 'ops-hr',            labelKey: 'categoryOpsHR',         icon: '👥' },
  { id: 'finance-investment', labelKey: 'categoryFinance',      icon: '💰', disabled: true },
  { id: 'marketing-growth',  labelKey: 'categoryMarketing',     icon: '📈', disabled: true },
  { id: 'sales-business',    labelKey: 'categorySales',         icon: '🤝', disabled: true },
];
