import { Resend } from 'resend';
import { PrismaClient } from '@prisma/client';
import { GoogleWorkspaceService } from '../services/googleWorkspaceService.js';

const resend = new Resend(process.env.RESEND_API_KEY);
const prisma = new PrismaClient();
const docService = new GoogleWorkspaceService();

export class SubscriptionBillingEngine {
  /**
   * Process full client subscription purchase
   */
  async processClientSubscription(userId: string, planTier: 'PRO' | 'ENTERPRISE', amountCents: number) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30-day billing cycle

    // 1. Create Subscription Record
    const sub = await prisma.subscription.create({
      data: {
        userId: user.id,
        planName: planTier,
        status: 'ACTIVE',
        amountCents,
        expiresAt,
      },
    });

    // 2. Upgrade User Model Tier
    await prisma.user.update({
      where: { id: user.id },
      data: { isSubscribed: true, planTier },
    });

    // 3. Generate Word/PDF Invoice Attachment
    const invoiceSummary = `INVOICE #${sub.id}\nCustomer: ${user.email}\nPlan: ${planTier}\nAmount Paid: $${(amountCents / 100).toFixed(2)}\nDate: ${new Date().toISOString()}`;
    const wordBuffer = await docService.exportToWord(`RyanAI Enterprise Invoice`, invoiceSummary);

    // 4. Dispatch Email with Invoice
    await resend.emails.send({
      from: 'RyanAI Subscriptions <billing@ganyane.dev>',
      to: user.email,
      subject: `🎉 Subscription Confirmed: RyanAI ${planTier} Tier Activated`,
      html: `
        <div style="font-family: sans-serif; background: #020617; color: #f8fafc; padding: 24px; border-radius: 8px;">
          <h2 style="color: #38bdf8;">Welcome to RyanAI Enterprise</h2>
          <p>Your subscription for tier <strong>${planTier}</strong> is now live.</p>
          <p>Execution limits have been upgraded to unlimited enterprise priority processing.</p>
          <hr style="border-color: #1e293b;" />
          <p style="font-size: 12px; color: #94a3b8;">Find your official invoice attached below.</p>
        </div>
      `,
      attachments: [
        {
          filename: `Invoice_${sub.id.slice(0, 8)}.docx`,
          content: wordBuffer,
        },
      ],
    });

    return sub;
  }
}