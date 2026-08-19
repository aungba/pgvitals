/**
 * Slack Block Kit Builder for Remote Remediation Alerts
 * Spec §6.3 — Slack Block Kit & Microsoft Teams Payloads
 */

export interface BlockingAlertSlackOptions {
  databaseId: string;
  databaseName: string;
  blockerPid: number;
  blockedCount: number;
  durationSeconds: number;
  querySnippet: string;
  appBaseUrl?: string;
}

export function buildBlockingAlertSlackPayload(options: BlockingAlertSlackOptions) {
  const {
    databaseId,
    databaseName,
    blockerPid,
    blockedCount,
    durationSeconds,
    querySnippet,
    appBaseUrl = "https://app.pgvitals.io",
  } = options;

  const truncatedQuery =
    querySnippet.length > 500
      ? querySnippet.slice(0, 500) + "..."
      : querySnippet;

  return {
    text: `🔴 Critical: Session ${blockerPid} blocking ${blockedCount} queries on ${databaseName}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🔴 Critical: Blocking Chain Exceeded 30s Threshold",
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Database:*\n${databaseName}`,
          },
          {
            type: "mrkdwn",
            text: `*Root Blocker PID:*\n\`${blockerPid}\``,
          },
          {
            type: "mrkdwn",
            text: `*Blocked Sessions:*\n\`${blockedCount} waiting\``,
          },
          {
            type: "mrkdwn",
            text: `*Duration:*\n${durationSeconds}s`,
          },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Blocker Query Snippet:*\n\`\`\`sql\n${truncatedQuery}\n\`\`\``,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: `⚡ Terminate Blocker (PID ${blockerPid})`,
              emoji: true,
            },
            style: "danger",
            action_id: "pgvitals_terminate_session",
            value: JSON.stringify({ dbId: databaseId, pid: blockerPid }),
            confirm: {
              title: {
                type: "plain_text",
                text: "Confirm Session Kill",
              },
              text: {
                type: "plain_text",
                text: `Are you sure you want to terminate backend PID ${blockerPid}? Active transactions in that session will be aborted and rolled back.`,
              },
              confirm: {
                type: "plain_text",
                text: "Terminate Immediately",
              },
              deny: {
                type: "plain_text",
                text: "Cancel",
              },
            },
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "🔍 View Live Tree in PG Vitals",
              emoji: true,
            },
            url: `${appBaseUrl}/databases/${databaseId}?tab=sessions&filter=blocked`,
          },
        ],
      },
    ],
  };
}
