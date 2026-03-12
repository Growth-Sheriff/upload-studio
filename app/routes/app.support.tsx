import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams } from "@remix-run/react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack,
  Badge, DataTable, Button, Modal, TextField, Select,
  Banner, Filters, ChoiceList, Divider, Box,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "~/shopify.server";
import prisma from "~/lib/prisma.server";
import { sendTicketReply, sendTicketStatusUpdate } from "~/lib/email.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  
  // Only allow admin access (you can add role check here)
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });

  if (!shop) {
    return json({ tickets: [], stats: { open: 0, inProgress: 0, resolved: 0, total: 0 } });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "all";
  const category = url.searchParams.get("category") || "all";

  // Build where clause - scoped to this shop's tickets only
  const where: any = { shopDomain: session.shop };
  if (status !== "all") where.status = status;
  if (category !== "all") where.category = category;

  const shopScope = { shopDomain: session.shop };

  const [tickets, openCount, inProgressCount, resolvedCount, totalCount] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        replies: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.supportTicket.count({ where: { ...shopScope, status: "open" } }),
    prisma.supportTicket.count({ where: { ...shopScope, status: "in_progress" } }),
    prisma.supportTicket.count({ where: { ...shopScope, status: "resolved" } }),
    prisma.supportTicket.count({ where: shopScope }),
  ]);

  return json({
    tickets: tickets.map((t) => ({
      id: t.id,
      ticketNumber: t.ticketNumber,
      name: t.name,
      email: t.email,
      shopDomain: t.shopDomain,
      category: t.category,
      subject: t.subject,
      message: t.message,
      status: t.status,
      priority: t.priority,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      lastReply: t.replies[0]?.createdAt.toISOString() || null,
      replyCount: t.replies.length,
    })),
    stats: {
      open: openCount,
      inProgress: inProgressCount,
      resolved: resolvedCount,
      total: totalCount,
    },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const ticketId = formData.get("ticketId") as string;

  if (!ticketId) {
    return json({ success: false, error: "Ticket ID required" });
  }

  const ticket = await prisma.supportTicket.findFirst({
    where: { id: ticketId, shopDomain: session.shop },
  });

  if (!ticket) {
    return json({ success: false, error: "Ticket not found" });
  }

  if (intent === "update-status") {
    const newStatus = formData.get("status") as string;
    const note = formData.get("note") as string;

    await prisma.supportTicket.updateMany({
      where: { id: ticketId, shopDomain: session.shop },
      data: {
        status: newStatus,
        resolvedAt: newStatus === "resolved" ? new Date() : undefined,
      },
    });

    // Send status update email
    if (newStatus === "in_progress" || newStatus === "resolved" || newStatus === "closed") {
      await sendTicketStatusUpdate(
        ticket.ticketNumber,
        ticket.email,
        ticket.name,
        ticket.subject,
        newStatus as "in_progress" | "resolved" | "closed",
        note || undefined
      );
    }

    return json({ success: true });
  }

  if (intent === "reply") {
    const replyMessage = formData.get("message") as string;
    const agentName = formData.get("agentName") as string || "Support Team";

    if (!replyMessage) {
      return json({ success: false, error: "Reply message required" });
    }

    // Create reply record
    const reply = await prisma.supportReply.create({
      data: {
        ticketId: ticket.id,
        message: replyMessage,
        isStaff: true,
        authorName: agentName,
        authorEmail: `support@${process.env.APP_DOMAIN || 'uploadstudio.app.techifyboost.com'}`,
      },
    });

    // Update ticket status if it was open
    if (ticket.status === "open") {
      await prisma.supportTicket.updateMany({
        where: { id: ticketId, shopDomain: session.shop },
        data: {
          status: "in_progress",
          firstReplyAt: ticket.firstReplyAt || new Date(),
        },
      });
    }

    // Send reply email
    const emailResult = await sendTicketReply(
      ticket.ticketNumber,
      ticket.email,
      ticket.name,
      ticket.subject,
      replyMessage,
      agentName
    );

    if (emailResult.success) {
      await prisma.supportReply.update({
        where: { id: reply.id },
        data: { emailSentAt: new Date() },
      });
    }

    return json({ success: true });
  }

  return json({ success: false, error: "Invalid intent" });
}

function StatCard({ title, value, tone }: { title: string; value: number; tone?: "success" | "warning" | "critical" }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">{title}</Text>
        <Text as="p" variant="headingLg" fontWeight="bold">
          {tone ? <Badge tone={tone}>{value.toString()}</Badge> : value}
        </Text>
      </BlockStack>
    </Card>
  );
}

function getStatusBadge(status: string) {
  switch (status) {
    case "open": return <Badge tone="attention">Open</Badge>;
    case "in_progress": return <Badge tone="info">In Progress</Badge>;
    case "resolved": return <Badge tone="success">Resolved</Badge>;
    case "closed": return <Badge>Closed</Badge>;
    default: return <Badge>{status}</Badge>;
  }
}

function getPriorityBadge(priority: string) {
  switch (priority) {
    case "urgent": return <Badge tone="critical">Urgent</Badge>;
    case "high": return <Badge tone="warning">High</Badge>;
    case "normal": return <Badge>Normal</Badge>;
    case "low": return <Badge tone="info">Low</Badge>;
    default: return <Badge>{priority}</Badge>;
  }
}

function getCategoryLabel(category: string) {
  const labels: Record<string, string> = {
    general: "General",
    support: "Support",
    billing: "Billing",
    feature: "Feature",
    bug: "Bug",
    partnership: "Partnership",
    gdpr: "GDPR",
  };
  return labels[category] || category;
}

export default function SupportPage() {
  const { tickets, stats } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedTicket, setSelectedTicket] = useState<typeof tickets[0] | null>(null);
  const [replyModalOpen, setReplyModalOpen] = useState(false);
  const [replyMessage, setReplyMessage] = useState("");
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [statusNote, setStatusNote] = useState("");

  const statusFilter = searchParams.get("status") || "all";
  const categoryFilter = searchParams.get("category") || "all";

  const handleStatusFilterChange = useCallback((value: string[]) => {
    const newParams = new URLSearchParams(searchParams);
    if (value[0] === "all") {
      newParams.delete("status");
    } else {
      newParams.set("status", value[0]);
    }
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  const handleCategoryFilterChange = useCallback((value: string[]) => {
    const newParams = new URLSearchParams(searchParams);
    if (value[0] === "all") {
      newParams.delete("category");
    } else {
      newParams.set("category", value[0]);
    }
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  const handleOpenReply = (ticket: typeof tickets[0]) => {
    setSelectedTicket(ticket);
    setReplyMessage("");
    setReplyModalOpen(true);
  };

  const handleSubmitReply = () => {
    if (!selectedTicket || !replyMessage) return;
    fetcher.submit(
      { intent: "reply", ticketId: selectedTicket.id, message: replyMessage },
      { method: "POST" }
    );
    setReplyModalOpen(false);
  };

  const handleOpenStatus = (ticket: typeof tickets[0]) => {
    setSelectedTicket(ticket);
    setNewStatus(ticket.status);
    setStatusNote("");
    setStatusModalOpen(true);
  };

  const handleSubmitStatus = () => {
    if (!selectedTicket) return;
    fetcher.submit(
      { intent: "update-status", ticketId: selectedTicket.id, status: newStatus, note: statusNote },
      { method: "POST" }
    );
    setStatusModalOpen(false);
  };

  const rows = tickets.map((t) => [
    <Text as="span" fontWeight="bold">{t.ticketNumber}</Text>,
    <BlockStack gap="100">
      <Text as="span">{t.name}</Text>
      <Text as="span" tone="subdued" variant="bodySm">{t.email}</Text>
    </BlockStack>,
    getCategoryLabel(t.category),
    <Text as="span" truncate>{t.subject}</Text>,
    getStatusBadge(t.status),
    getPriorityBadge(t.priority),
    new Date(t.createdAt).toLocaleDateString(),
    <InlineStack gap="100">
      <Button size="slim" onClick={() => handleOpenReply(t)}>Reply</Button>
      <Button size="slim" variant="plain" onClick={() => handleOpenStatus(t)}>Status</Button>
    </InlineStack>,
  ]);

  const filters = [
    {
      key: "status",
      label: "Status",
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={[
            { label: "All", value: "all" },
            { label: "Open", value: "open" },
            { label: "In Progress", value: "in_progress" },
            { label: "Resolved", value: "resolved" },
            { label: "Closed", value: "closed" },
          ]}
          selected={[statusFilter]}
          onChange={handleStatusFilterChange}
        />
      ),
      shortcut: true,
    },
    {
      key: "category",
      label: "Category",
      filter: (
        <ChoiceList
          title="Category"
          titleHidden
          choices={[
            { label: "All", value: "all" },
            { label: "General", value: "general" },
            { label: "Support", value: "support" },
            { label: "Billing", value: "billing" },
            { label: "Bug", value: "bug" },
            { label: "Feature", value: "feature" },
          ]}
          selected={[categoryFilter]}
          onChange={handleCategoryFilterChange}
        />
      ),
      shortcut: true,
    },
  ];

  return (
    <Page title="Support Tickets" subtitle="Manage customer support requests">
      <Layout>
        {!process.env.RESEND_API_KEY && (
          <Layout.Section>
            <Banner tone="warning">
              <p>
                <strong>Email not configured:</strong> Add <code>RESEND_API_KEY</code> to enable email notifications.
                Get your API key from <a href="https://resend.com/api-keys" target="_blank" rel="noopener">resend.com</a>
              </p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineStack gap="400" wrap={false}>
            <StatCard title="Open" value={stats.open} tone="warning" />
            <StatCard title="In Progress" value={stats.inProgress} tone="info" />
            <StatCard title="Resolved" value={stats.resolved} tone="success" />
            <StatCard title="Total" value={stats.total} />
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Filters
                queryValue=""
                filters={filters}
                onQueryChange={() => {}}
                onQueryClear={() => {}}
                onClearAll={() => {
                  setSearchParams(new URLSearchParams());
                }}
              />
              
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text"]}
                headings={["Ticket", "Customer", "Category", "Subject", "Status", "Priority", "Created", "Actions"]}
                rows={rows}
                footerContent={`${tickets.length} ticket${tickets.length !== 1 ? "s" : ""}`}
              />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Reply Modal */}
      <Modal
        open={replyModalOpen}
        onClose={() => setReplyModalOpen(false)}
        title={`Reply to ${selectedTicket?.ticketNumber}`}
        primaryAction={{
          content: "Send Reply",
          onAction: handleSubmitReply,
          loading: fetcher.state === "submitting",
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setReplyModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {selectedTicket && (
              <>
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="bold">{selectedTicket.subject}</Text>
                    <Text as="p" tone="subdued">{selectedTicket.message}</Text>
                  </BlockStack>
                </Box>
                <Divider />
              </>
            )}
            <TextField
              label="Your Reply"
              value={replyMessage}
              onChange={setReplyMessage}
              multiline={4}
              autoComplete="off"
              placeholder="Type your response..."
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Status Modal */}
      <Modal
        open={statusModalOpen}
        onClose={() => setStatusModalOpen(false)}
        title={`Update Status - ${selectedTicket?.ticketNumber}`}
        primaryAction={{
          content: "Update Status",
          onAction: handleSubmitStatus,
          loading: fetcher.state === "submitting",
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setStatusModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Select
              label="New Status"
              options={[
                { label: "Open", value: "open" },
                { label: "In Progress", value: "in_progress" },
                { label: "Resolved", value: "resolved" },
                { label: "Closed", value: "closed" },
              ]}
              value={newStatus}
              onChange={setNewStatus}
            />
            <TextField
              label="Note (optional)"
              value={statusNote}
              onChange={setStatusNote}
              multiline={2}
              autoComplete="off"
              placeholder="Add a note for the customer..."
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
