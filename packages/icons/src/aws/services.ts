// Curated list of AWS services: short id -> file inside the official zip.
// Pure data, no Vite APIs: read by the script (Node), the server and the browser.

export const AWS_PACKAGE_VERSION = "07312026";
// Every path in the zip starts with this folder.
export const AWS_PACKAGE_ROOT = `Architecture-Service-Icons_${AWS_PACKAGE_VERSION}/`;

export interface AwsService {
  /** Short lowercase id with hyphens (`s3`, `api-gateway`). */
  id: string;
  /** Path inside the zip, relative to AWS_PACKAGE_ROOT. */
  file: string;
  /** Dictation words Claude should understand as this service. */
  synonyms?: string[];
}

export const AWS_SERVICES: AwsService[] = [
  { id: "lambda", file: "Arch_Compute/64/Arch_AWS-Lambda_64.svg" },
  { id: "ec2", file: "Arch_Compute/64/Arch_Amazon-EC2_64.svg" },
  { id: "ecs", file: "Arch_Containers/64/Arch_Amazon-Elastic-Container-Service_64.svg" },
  { id: "eks", file: "Arch_Containers/64/Arch_Amazon-Elastic-Kubernetes-Service_64.svg" },
  { id: "fargate", file: "Arch_Containers/64/Arch_AWS-Fargate_64.svg" },
  { id: "s3", file: "Arch_Storage/64/Arch_Amazon-Simple-Storage-Service_64.svg", synonyms: ["bucket"] },
  { id: "efs", file: "Arch_Storage/64/Arch_Amazon-EFS_64.svg" },
  { id: "dynamodb", file: "Arch_Databases/64/Arch_Amazon-DynamoDB_64.svg" },
  { id: "rds", file: "Arch_Databases/64/Arch_Amazon-RDS_64.svg" },
  { id: "aurora", file: "Arch_Databases/64/Arch_Amazon-Aurora_64.svg" },
  { id: "elasticache", file: "Arch_Databases/64/Arch_Amazon-ElastiCache_64.svg" },
  { id: "api-gateway", file: "Arch_Networking-Content-Delivery/64/Arch_Amazon-API-Gateway_64.svg" },
  { id: "cloudfront", file: "Arch_Networking-Content-Delivery/64/Arch_Amazon-CloudFront_64.svg" },
  { id: "route-53", file: "Arch_Networking-Content-Delivery/64/Arch_Amazon-Route-53_64.svg" },
  { id: "vpc", file: "Arch_Networking-Content-Delivery/64/Arch_Amazon-Virtual-Private-Cloud_64.svg" },
  { id: "elb", file: "Arch_Networking-Content-Delivery/64/Arch_Elastic-Load-Balancing_64.svg", synonyms: ["load balancer", "ALB"] },
  { id: "sqs", file: "Arch_Application-Integration/64/Arch_Amazon-Simple-Queue-Service_64.svg" },
  { id: "sns", file: "Arch_Application-Integration/64/Arch_Amazon-Simple-Notification-Service_64.svg" },
  { id: "eventbridge", file: "Arch_Application-Integration/64/Arch_Amazon-EventBridge_64.svg", synonyms: ["CloudWatch Events"] },
  { id: "step-functions", file: "Arch_Application-Integration/64/Arch_AWS-Step-Functions_64.svg" },
  { id: "appsync", file: "Arch_Application-Integration/64/Arch_AWS-AppSync_64.svg" },
  { id: "cognito", file: "Arch_Security-Identity/64/Arch_Amazon-Cognito_64.svg", synonyms: ["user pool"] },
  { id: "iam", file: "Arch_Security-Identity/64/Arch_AWS-Identity-and-Access-Management_64.svg" },
  { id: "kms", file: "Arch_Security-Identity/64/Arch_AWS-Key-Management-Service_64.svg" },
  { id: "secrets-manager", file: "Arch_Security-Identity/64/Arch_AWS-Secrets-Manager_64.svg" },
  { id: "waf", file: "Arch_Security-Identity/64/Arch_AWS-WAF_64.svg" },
  { id: "cloudwatch", file: "Arch_Management-Tools/64/Arch_Amazon-CloudWatch_64.svg" },
  { id: "cloudformation", file: "Arch_Management-Tools/64/Arch_AWS-CloudFormation_64.svg" },
  { id: "cloudtrail", file: "Arch_Management-Tools/64/Arch_AWS-CloudTrail_64.svg" },
  { id: "kinesis", file: "Arch_Analytics/64/Arch_Amazon-Kinesis_64.svg" },
  { id: "athena", file: "Arch_Analytics/64/Arch_Amazon-Athena_64.svg" },
  { id: "glue", file: "Arch_Analytics/64/Arch_AWS-Glue_64.svg" },
  { id: "redshift", file: "Arch_Analytics/64/Arch_Amazon-Redshift_64.svg" },
  { id: "opensearch", file: "Arch_Analytics/64/Arch_Amazon-OpenSearch-Service_64.svg", synonyms: ["Elasticsearch"] },
  { id: "bedrock", file: "Arch_Artificial-Intelligence/64/Arch_Amazon-Bedrock_64.svg" },
  { id: "sagemaker", file: "Arch_Artificial-Intelligence/64/Arch_Amazon-SageMaker-AI_64.svg" },
  { id: "codepipeline", file: "Arch_Developer-Tools/64/Arch_AWS-CodePipeline_64.svg" },
  { id: "codebuild", file: "Arch_Developer-Tools/64/Arch_AWS-CodeBuild_64.svg" },
  { id: "amplify", file: "Arch_Front-End-Web-Mobile/64/Arch_AWS-Amplify_64.svg" },
  { id: "ses", file: "Arch_Business-Applications/64/Arch_Amazon-Simple-Email-Service_64.svg" },
];
