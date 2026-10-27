// Lista curada de servicios de AWS (ticket 03): id corto -> archivo dentro del zip oficial.
// Datos puros, sin APIs de Vite: lo leen el script (Node), el servidor y el navegador.

export const AWS_VERSION_PAQUETE = "07312026";
export const AWS_PREFIJO_CATALOGO = "aws";
// Todas las rutas del zip empiezan por esta carpeta.
export const AWS_RAIZ_PAQUETE = `Architecture-Service-Icons_${AWS_VERSION_PAQUETE}/`;

export interface ServicioAws {
  /** Id corto en minúsculas con guion (`s3`, `api-gateway`). */
  id: string;
  /** Ruta dentro del zip, relativa a AWS_RAIZ_PAQUETE. */
  archivo: string;
  /** Palabras de dictado que Claude debe entender como este servicio. */
  sinonimos?: string[];
}

export const SERVICIOS_AWS: ServicioAws[] = [
  { id: "lambda", archivo: "Arch_Compute/64/Arch_AWS-Lambda_64.svg" },
  { id: "ec2", archivo: "Arch_Compute/64/Arch_Amazon-EC2_64.svg" },
  { id: "ecs", archivo: "Arch_Containers/64/Arch_Amazon-Elastic-Container-Service_64.svg" },
  { id: "eks", archivo: "Arch_Containers/64/Arch_Amazon-Elastic-Kubernetes-Service_64.svg" },
  { id: "fargate", archivo: "Arch_Containers/64/Arch_AWS-Fargate_64.svg" },
  { id: "s3", archivo: "Arch_Storage/64/Arch_Amazon-Simple-Storage-Service_64.svg", sinonimos: ["bucket"] },
  { id: "efs", archivo: "Arch_Storage/64/Arch_Amazon-EFS_64.svg" },
  { id: "dynamodb", archivo: "Arch_Databases/64/Arch_Amazon-DynamoDB_64.svg" },
  { id: "rds", archivo: "Arch_Databases/64/Arch_Amazon-RDS_64.svg" },
  { id: "aurora", archivo: "Arch_Databases/64/Arch_Amazon-Aurora_64.svg" },
  { id: "elasticache", archivo: "Arch_Databases/64/Arch_Amazon-ElastiCache_64.svg" },
  { id: "api-gateway", archivo: "Arch_Networking-Content-Delivery/64/Arch_Amazon-API-Gateway_64.svg" },
  { id: "cloudfront", archivo: "Arch_Networking-Content-Delivery/64/Arch_Amazon-CloudFront_64.svg" },
  { id: "route-53", archivo: "Arch_Networking-Content-Delivery/64/Arch_Amazon-Route-53_64.svg" },
  { id: "vpc", archivo: "Arch_Networking-Content-Delivery/64/Arch_Amazon-Virtual-Private-Cloud_64.svg" },
  { id: "elb", archivo: "Arch_Networking-Content-Delivery/64/Arch_Elastic-Load-Balancing_64.svg", sinonimos: ["load balancer", "ALB"] },
  { id: "sqs", archivo: "Arch_Application-Integration/64/Arch_Amazon-Simple-Queue-Service_64.svg" },
  { id: "sns", archivo: "Arch_Application-Integration/64/Arch_Amazon-Simple-Notification-Service_64.svg" },
  { id: "eventbridge", archivo: "Arch_Application-Integration/64/Arch_Amazon-EventBridge_64.svg", sinonimos: ["CloudWatch Events"] },
  { id: "step-functions", archivo: "Arch_Application-Integration/64/Arch_AWS-Step-Functions_64.svg" },
  { id: "appsync", archivo: "Arch_Application-Integration/64/Arch_AWS-AppSync_64.svg" },
  { id: "cognito", archivo: "Arch_Security-Identity/64/Arch_Amazon-Cognito_64.svg", sinonimos: ["user pool"] },
  { id: "iam", archivo: "Arch_Security-Identity/64/Arch_AWS-Identity-and-Access-Management_64.svg" },
  { id: "kms", archivo: "Arch_Security-Identity/64/Arch_AWS-Key-Management-Service_64.svg" },
  { id: "secrets-manager", archivo: "Arch_Security-Identity/64/Arch_AWS-Secrets-Manager_64.svg" },
  { id: "waf", archivo: "Arch_Security-Identity/64/Arch_AWS-WAF_64.svg" },
  { id: "cloudwatch", archivo: "Arch_Management-Tools/64/Arch_Amazon-CloudWatch_64.svg" },
  { id: "cloudformation", archivo: "Arch_Management-Tools/64/Arch_AWS-CloudFormation_64.svg" },
  { id: "cloudtrail", archivo: "Arch_Management-Tools/64/Arch_AWS-CloudTrail_64.svg" },
  { id: "kinesis", archivo: "Arch_Analytics/64/Arch_Amazon-Kinesis_64.svg" },
  { id: "athena", archivo: "Arch_Analytics/64/Arch_Amazon-Athena_64.svg" },
  { id: "glue", archivo: "Arch_Analytics/64/Arch_AWS-Glue_64.svg" },
  { id: "redshift", archivo: "Arch_Analytics/64/Arch_Amazon-Redshift_64.svg" },
  { id: "opensearch", archivo: "Arch_Analytics/64/Arch_Amazon-OpenSearch-Service_64.svg", sinonimos: ["Elasticsearch"] },
  { id: "bedrock", archivo: "Arch_Artificial-Intelligence/64/Arch_Amazon-Bedrock_64.svg" },
  { id: "sagemaker", archivo: "Arch_Artificial-Intelligence/64/Arch_Amazon-SageMaker-AI_64.svg" },
  { id: "codepipeline", archivo: "Arch_Developer-Tools/64/Arch_AWS-CodePipeline_64.svg" },
  { id: "codebuild", archivo: "Arch_Developer-Tools/64/Arch_AWS-CodeBuild_64.svg" },
  { id: "amplify", archivo: "Arch_Front-End-Web-Mobile/64/Arch_AWS-Amplify_64.svg" },
  { id: "ses", archivo: "Arch_Business-Applications/64/Arch_Amazon-Simple-Email-Service_64.svg" },
];
