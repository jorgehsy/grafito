import type { PillarId } from "./types";

// Hand-written, not fetched: the definitions summarize each pillar in our own words, and the order
// is the framework's. The refresh script reads this list to know which pillars to fetch.
export const PILLARS: readonly { id: PillarId; name: string; definition: string }[] = [
  {
    id: "OPS",
    name: "Operational excellence",
    definition: "Run and observe workloads so they deliver business value, and keep improving the processes that support them.",
  },
  {
    id: "SEC",
    name: "Security",
    definition: "Protect data, systems and assets, using what the cloud offers to strengthen the security posture.",
  },
  {
    id: "REL",
    name: "Reliability",
    definition: "The workload does what it should, correctly and consistently, and recovers quickly when something fails.",
  },
  {
    id: "PERF",
    name: "Performance efficiency",
    definition: "Use computing resources efficiently to meet requirements, and stay efficient as demand and technology change.",
  },
  {
    id: "COST",
    name: "Cost optimization",
    definition: "Deliver business value at the lowest cost, avoiding spend that brings no value.",
  },
  {
    id: "SUS",
    name: "Sustainability",
    definition: "Reduce the environmental impact of running workloads, mostly by using less energy and fewer resources.",
  },
];
