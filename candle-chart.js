class CandleChart {
    constructor() {
        this.chart = null;
        this.rsiChart = null;
        this.macdChart = null;
        this.data = [];
        this.timeframe = '1m';
        this.pair = 'BTCUSDT';
        this.refreshInterval = null;
        this.trades = [];
        this.currentPosition = null;
        this.previousPair = this.pair;
        this.executedSignals = new Set();
        this.signalMarkers = [];
        this.tradeMarkers = [];
        this.tradeLines = [];

        this.tradeSettings = {
            stopLossPercent: 0.40, // 2% stop loss
            takeProfitPercent: 0.80, // 5% take profit
            positionSizePercent: 10, // Risk 10% of virtual balance per trade
            virtualBalance: 25000, // Starting virtual balance
            startingBalance: 25000,
            commission: 0.001, // 0.1% trading commission
            slippage: 0.001, // 0.5% price slippage
            dollerPrice: 93.0
        };

        this.performanceMetrics = {
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            winRate: 0,
            totalPnl: 0,
            maxDrawdown: 0,
            profitFactor: 0,
            averageTradeDuration: 0
        };

        this.indicators = {
            supertrend: {
                enabled: true,
                period: 10,
                multiplier: 3
            },
            rsi: {
                enabled: true,
                period: 14,
                overbought: 70,
                oversold: 30
            },
            macd: {
                enabled: true,
                fastPeriod: 12,
                slowPeriod: 26,
                signalPeriod: 9
            },
            supportResistance: {
                enabled: true,
                period: 20
            }
        };

        this.binanceTimeframes = {
            '1m': '1m',
            '5m': '5m',
            '15m': '15m',
            '1h': '1h',
            '4h': '4h',
            '1d': '1d'
        };

        this.initChart();
        this.initEventListeners();
        this.loadData();
        this.startAutoRefresh();
        this.loadTradeData();

    }
    saveTradeData() {
        const tradeData = {
            trades: this.trades,
            currentPosition: this.currentPosition,
            virtualBalance: this.tradeSettings.virtualBalance,
            performanceMetrics: this.performanceMetrics,
            pair: this.pair
        };
        localStorage.setItem(`tradeData_${this.pair}`, JSON.stringify(tradeData));
    }

    loadTradeData() {
        try {
            // Clear executed signals when loading new data
            this.executedSignals = new Set();
            const savedData = localStorage.getItem(`tradeData_${this.pair}`);
            if (savedData) {
                const tradeData = JSON.parse(savedData);

                // Validate the loaded data structure
                if (!tradeData || typeof tradeData !== 'object') {
                    throw new Error('Invalid trade data format');
                }

                this.trades = Array.isArray(tradeData.trades) ? tradeData.trades : [];
                this.currentPosition = tradeData.currentPosition || null;

                // Validate and set virtual balance
                const virtualBalance = parseFloat(tradeData.virtualBalance);
                this.tradeSettings.virtualBalance = isNaN(virtualBalance) ? 25000 : virtualBalance;

                // Validate performance metrics
                this.performanceMetrics = {
                    totalTrades: parseInt(tradeData.performanceMetrics?.totalTrades) || 0,
                    winningTrades: parseInt(tradeData.performanceMetrics?.winningTrades) || 0,
                    losingTrades: parseInt(tradeData.performanceMetrics?.losingTrades) || 0,
                    winRate: parseFloat(tradeData.performanceMetrics?.winRate) || 0,
                    totalPnl: parseFloat(tradeData.performanceMetrics?.totalPnl) || 0,
                    maxDrawdown: parseFloat(tradeData.performanceMetrics?.maxDrawdown) || 0,
                    profitFactor: parseFloat(tradeData.performanceMetrics?.profitFactor) || 0,
                    averageTradeDuration: parseFloat(tradeData.performanceMetrics?.averageTradeDuration) || 0
                };

                // Recreate trade visuals when data is loaded
                this.recreateTradeVisuals();
                this.updatePerformanceMetrics();

                //console.log('Successfully loaded trade data for', this.pair);
            }
        } catch (error) {
            console.error('Error loading trade data:', error);
            // Reset to defaults if loading fails
            this.trades = [];
            this.currentPosition = null;
            this.tradeSettings.virtualBalance = 25000;
            this.executedSignals = new Set();
            this.performanceMetrics = {
                totalTrades: 0,
                winningTrades: 0,
                losingTrades: 0,
                winRate: 0,
                totalPnl: 0,
                maxDrawdown: 0,
                profitFactor: 0,
                averageTradeDuration: 0
            };
        }
    }
    // Add this new method
    simulateTrades(data) {
        this.tradeMarkers = [];
        this.tradeLines = [];

        // Sort data by time if not already sorted
        data.sort((a, b) => new Date(a.time) - new Date(b.time));

        for (let i = 0; i < data.length; i++) {
            const candle = data[i];
            //console.log(candle);
            if (!candle.signal || !candle.signal.type)
                continue;

            // Create a unique identifier for this signal
            const signalId = `${candle.time}_${candle.signal.type}`;
            if (this.executedSignals.has(signalId)) {
                continue;
            }
            this.executedSignals.add(signalId);

            // Skip if candle time is too old
            const currentTime = new Date();
            const candleTime = new Date(candle.time);
            const maxTimeDiff = 1 * 60 * 1000; // 1 minute
            if (currentTime - candleTime > maxTimeDiff)
                continue;

            // realistic entry price: use signal.price vs market price (never use future candle high)
            const isBuySignal = candle.signal.type.toLowerCase().includes('buy');
            const isSellSignal = candle.signal.type.toLowerCase().includes('sell') || candle.signal.type.toLowerCase().includes('short');

            const marketPrice = (this.data && this.data.length) ? this.data[this.data.length - 1].close : null;
            const entryPrice = parseFloat(Number(candle.signal.price).toFixed(8));

            const currentHour = new Date().getHours();
            const isGoodTradingTime = currentHour >= 9 && currentHour <= 16; // 9 AM - 4 PM UTC

            if (!isGoodTradingTime) {
                console.log("Skipping signals outside trading hours");
                //return;
            }

            const newStrength = candle.signal.confidence ?? 0;

            // -----------------------
            // HANDLE BUY SIGNALS
            // -----------------------
            if (isBuySignal) {
                if (this.currentPosition) {
                    // Currently short -> close short then open long
                    if (this.currentPosition.type === 'sell') {
					const currentStrength = this.currentPosition.signalConfidence || 0;
						if (newStrength > currentStrength) {
                        const exitPrice = candle.signal.price;
                        this.closePosition(candle, i, exitPrice, 'signal');

                        // Open new buy position after closing sell
                        const positionSize = this.calculatePositionSize(entryPrice);
                        const commissionPaid = positionSize * entryPrice * this.tradeSettings.commission;
                        const cost = positionSize * entryPrice;
                        this.tradeSettings.virtualBalance -= (cost + commissionPaid)

                        this.currentPosition = {
                            type: 'buy',
                            entryPrice: entryPrice,
                            entryTime: candle.time,
                            entryCandleIndex: i,
                            positionSize: positionSize,
                            stopLoss: entryPrice * (1 - (this.tradeSettings.stopLossPercent / 100)),
                            takeProfit: entryPrice * (1 + (this.tradeSettings.takeProfitPercent / 100)),
                            commissionPaid: commissionPaid,
                            signalConfidence: newStrength
                        };
                        this.showTradeNotification(this.currentPosition, true);
                        this.addTradeMarker(candle.time, entryPrice, 'buy', `BUY @ ${entryPrice.toFixed(2)}`);
                    }
					}
                    // Currently long -> consider adding only if stronger AND in profit
                    else if (this.currentPosition.type === 'not buy') {
                        const currentPrice = candle.close;
                        const profitPercent = ((currentPrice - this.currentPosition.entryPrice) / this.currentPosition.entryPrice) * 100;

                        if (profitPercent > 0 && newStrength > (this.currentPosition.signalConfidence ?? 0)) {
                            const additionalSize = this.calculatePositionSize(entryPrice);
                            const additionalCost = additionalSize * entryPrice;
                            const additionalCommission = additionalCost * this.tradeSettings.commission;

                            this.currentPosition.positionSize += additionalSize;
                            this.currentPosition.commissionPaid += additionalCommission;
                            this.tradeSettings.virtualBalance -= (additionalCost + additionalCommission);

                            // Adjust SL and TP - reduce by half from original distance
							this.currentPosition.entryPrice = (currentPrice + this.currentPosition.entryPrice)/2;
                            const originalSLDistance = (this.currentPosition.entryPrice - this.currentPosition.stopLoss);
                            const originalTPDistance = (this.currentPosition.takeProfit - this.currentPosition.entryPrice);
							
                            this.currentPosition.stopLoss = this.currentPosition.entryPrice - (originalSLDistance * 0.5);
                            this.currentPosition.takeProfit = this.currentPosition.entryPrice + (originalTPDistance * 0.5);

                            this.currentPosition.signalConfidence = newStrength;

                            this.showTradeNotification({
                                type: 'buy',
                                entryPrice: this.currentPosition.entryPrice,
                                positionSize: additionalSize,
                                action: 'added (in profit)'
                            }, true);
                            this.addTradeMarker(candle.time, entryPrice, 'buy-add',
`ADD BUY @ ${entryPrice.toFixed(2)} (TP:${this.currentPosition.takeProfit.toFixed(2)}, SL:${this.currentPosition.stopLoss.toFixed(2)})`);
                        }
                    }
                } else {
                    // Open new buy position if no position exists
                    const positionSize = this.calculatePositionSize(entryPrice);
                    const commissionPaid = positionSize * entryPrice * this.tradeSettings.commission;
                    const cost = positionSize * entryPrice;

                    // Deduct principal + commission
                    this.tradeSettings.virtualBalance -= (cost + commissionPaid);

                    this.currentPosition = {
                        type: 'buy',
                        entryPrice: entryPrice,
                        entryTime: candle.time,
                        entryCandleIndex: i,
                        positionSize: positionSize,
                        stopLoss: entryPrice * (1 - (this.tradeSettings.stopLossPercent / 100)),
                        takeProfit: entryPrice * (1 + (this.tradeSettings.takeProfitPercent / 100)),
                        commissionPaid: commissionPaid,
                        signalConfidence: newStrength
                    };
                    this.showTradeNotification(this.currentPosition, true);
                    this.addTradeMarker(candle.time, entryPrice, 'buy', `BUY @ ${entryPrice.toFixed(2)}`);
                }
            }

            // -----------------------
            // HANDLE SELL SIGNALS
            // -----------------------
            else if (isSellSignal) {
                if (this.currentPosition) {
                    // Currently long -> close long then open short
                    if (this.currentPosition.type === 'buy') {
					const currentStrength = this.currentPosition.signalConfidence || 0;
						if (newStrength > currentStrength) {
                        const exitPrice = candle.signal.price;
                        this.closePosition(candle, i, exitPrice, 'signal');

                        // Open new sell position after closing buy
                        const positionSize = this.calculatePositionSize(entryPrice);
                        const commissionPaid = positionSize * entryPrice * this.tradeSettings.commission;
                        const cost = positionSize * entryPrice;

                        // Changed: Deduct full cost for sell positions too
                        this.tradeSettings.virtualBalance -= (cost + commissionPaid);
                        //console.log(this.tradeSettings.virtualBalance);
                        this.currentPosition = {
                            type: 'sell',
                            entryPrice: entryPrice,
                            entryTime: candle.time,
                            entryCandleIndex: i,
                            positionSize: positionSize,
                            stopLoss: entryPrice * (1 + (this.tradeSettings.stopLossPercent / 100)),
                            takeProfit: entryPrice * (1 - (this.tradeSettings.takeProfitPercent / 100)),
                            commissionPaid: commissionPaid,
                            signalConfidence: newStrength
                        };
                        this.showTradeNotification(this.currentPosition, true);
                        this.addTradeMarker(candle.time, entryPrice, 'sell', 'SELL');
						}
                    }
                    // Currently short -> consider adding only if stronger AND in profit
                    else if (this.currentPosition.type === 'not sell') {
                        const currentPrice = candle.close;
                        const profitPercent = ((this.currentPosition.entryPrice - currentPrice) / this.currentPosition.entryPrice) * 100;

                        if (profitPercent > 0 && newStrength > (this.currentPosition.signalConfidence ?? 0)) {
                            const additionalSize = this.calculatePositionSize(entryPrice);
                            const additionalCost = additionalSize * entryPrice;
                            const additionalCommission = additionalCost * this.tradeSettings.commission;

                            this.currentPosition.positionSize += (this.currentPosition.positionSize + additionalSize) / 2;
                            this.currentPosition.commissionPaid += additionalCommission;
							//console.log(additionalCost,additionalCommission,this.tradeSettings.virtualBalance);
                            this.tradeSettings.virtualBalance -= (additionalCost - additionalCommission);

                            // Adjust SL and TP - reduce by half from original distance
							this.currentPosition.entryPrice = (currentPrice + this.currentPosition.entryPrice)/2;
                            const originalSLDistance = (this.currentPosition.stopLoss - this.currentPosition.entryPrice);
                            const originalTPDistance = (this.currentPosition.entryPrice - this.currentPosition.takeProfit);
							
                            this.currentPosition.stopLoss = this.currentPosition.entryPrice + (originalSLDistance * 0.5);
                            this.currentPosition.takeProfit = this.currentPosition.entryPrice - (originalTPDistance * 0.5);
							
							//console.log(this.currentPosition.entryPrice);
							//console.log(this.currentPosition.stopLoss,originalSLDistance);
							//console.log(this.currentPosition.takeProfit,originalTPDistance);
                            this.currentPosition.signalConfidence = newStrength;

                            this.showTradeNotification({
                                type: 'sell',
                                entryPrice: this.currentPosition.entryPrice,
                                positionSize: additionalSize,
                                action: 'added (in profit)'
                            }, true);
                            this.addTradeMarker(candle.time, entryPrice, 'sell-add',
`ADD SELL @ ${entryPrice.toFixed(2)} (TP:${this.currentPosition.takeProfit.toFixed(2)}, SL:${this.currentPosition.stopLoss.toFixed(2)})`);
                        }
                    }
                } else {
                    // Open new sell position if no position exists
                    const positionSize = this.calculatePositionSize(entryPrice);
                    const commissionPaid = positionSize * entryPrice * this.tradeSettings.commission;
                    const cost = positionSize * entryPrice;

                    // Changed: Deduct full cost for sell positions too
                    this.tradeSettings.virtualBalance = (this.tradeSettings.virtualBalance).toFixed(2) - (cost + commissionPaid).toFixed(2);
                    //console.log(this.tradeSettings.virtualBalance);
                    this.currentPosition = {
                        type: 'sell',
                        entryPrice: entryPrice,
                        entryTime: candle.time,
                        entryCandleIndex: i,
                        positionSize: positionSize,
                        stopLoss: entryPrice * (1 + (this.tradeSettings.stopLossPercent / 100)),
                        takeProfit: entryPrice * (1 - (this.tradeSettings.takeProfitPercent / 100)),
                        commissionPaid: commissionPaid,
                        signalConfidence: newStrength
                    };
                    this.showTradeNotification(this.currentPosition, true);
                    this.addTradeMarker(candle.time, entryPrice, 'sell', 'SELL');
                }
            }

            // Check for stop loss or take profit on current position
            this.checkPositionExitConditions(candle, i);
        }

        this.updateTradeList();
        this.updateChart();
        this.updatePerformanceMetrics();
        this.saveTradeData();
    }

    calculatePositionSize(entryPrice) {
        const riskAmount = Math.min(
                this.tradeSettings.virtualBalance * (this.tradeSettings.positionSizePercent / 100),
                this.tradeSettings.virtualBalance * 0.9 // Never risk more than 90% of balance
            );
        const positionSize = riskAmount / entryPrice;
        return parseFloat(positionSize.toFixed(8));
    }

    async closePosition(candle, candleIndex, exitPrice, exitReason) {
    if (!this.currentPosition) return;

    const isBuyPosition = this.currentPosition.type === 'buy';
    const posSize = this.currentPosition.positionSize;
    const entryPrice = this.currentPosition.entryPrice;
    const entryCommissionPaid = this.currentPosition.commissionPaid || 0;

    // Handle partial close for take profit (exit half quantity)
    if (exitReason === 'not take profit') {
        const halfSize = posSize / 2;
        const exitCommission = halfSize * exitPrice * this.tradeSettings.commission;

        // Calculate PnL for the half position
        let pnlAmount = 0;
        if (isBuyPosition) {
            // For long position
            pnlAmount = halfSize * (exitPrice - entryPrice) * this.tradeSettings.dollerPrice;
            this.tradeSettings.virtualBalance += (halfSize * exitPrice) - exitCommission;
        } else {
            // For short position - return borrowed amount and settle PnL
            pnlAmount = halfSize * (entryPrice - exitPrice) * this.tradeSettings.dollerPrice;
            this.tradeSettings.virtualBalance += (halfSize * entryPrice) + pnlAmount - exitCommission;
        }

        const pnlPercent = (entryPrice > 0) ? (pnlAmount / (halfSize * entryPrice * this.tradeSettings.dollerPrice)) * 100 : 0;

        // Create trade record for the half position
        const trade = {
            type: this.currentPosition.type,
            entryPrice: entryPrice,
            exitPrice: exitPrice,
            pnlPercent: pnlPercent,
            pnlAmount: pnlAmount,
            positionSize: halfSize,
            entryTime: this.currentPosition.entryTime,
            entryCandleIndex: this.currentPosition.entryCandleIndex,
            exitTime: candle.time,
            exitReason: 'partial take profit',
            commissions: (entryCommissionPaid * 0.5) + exitCommission,
            virtualBalanceAfter: this.tradeSettings.virtualBalance
        };

        this.trades.push(trade);

        // Reduce the current position size by half
        this.currentPosition.positionSize = halfSize;
        this.currentPosition.commissionPaid = entryCommissionPaid * 0.5;

        // Show notification & visuals
        this.showTradeNotification(trade, false);
        this.addTradeMarker(candle.time, exitPrice, 'take-profit',
            `PARTIAL TP @ ${exitPrice.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);

        // Add trade line for the partial close
        this.addTradeLine({
            entryPrice: entryPrice,
            entryTime: this.currentPosition.entryTime,
            entryCandleIndex: this.currentPosition.entryCandleIndex,
            positionSize: halfSize
        }, candle, exitPrice);

        // Update the take profit level for remaining position
        if (isBuyPosition) {
            this.currentPosition.takeProfit = exitPrice * 1.01; // Move TP 1% higher for remaining position
        } else {
            this.currentPosition.takeProfit = exitPrice * 0.99; // Move TP 1% lower for remaining position
        }

        this.updateTradeList();
        this.updatePerformanceMetrics();
        this.saveTradeData();
        return;
    }

    // Full position close for other exit reasons (stop loss, signal, etc.)
    const exitCommission = posSize * exitPrice * this.tradeSettings.commission;
    let pnlAmount = 0;
    
    if (isBuyPosition) {
        // For long position
        pnlAmount = posSize * (exitPrice - entryPrice) * this.tradeSettings.dollerPrice;
        this.tradeSettings.virtualBalance += (posSize * entryPrice) + pnlAmount - exitCommission;
    } else {
        // For short position - return borrowed amount and settle PnL
        pnlAmount = posSize * (entryPrice - exitPrice) * this.tradeSettings.dollerPrice;
        this.tradeSettings.virtualBalance += (posSize * entryPrice) + pnlAmount - exitCommission;
    }

    const pnlPercent = (entryPrice > 0) ? (pnlAmount / (posSize * entryPrice * this.tradeSettings.dollerPrice)) * 100 : 0;

    // Create trade record
    const trade = {
        type: this.currentPosition.type,
        entryPrice: entryPrice,
        exitPrice: exitPrice,
        pnlPercent: pnlPercent,
        pnlAmount: pnlAmount,
        positionSize: posSize,
        entryTime: this.currentPosition.entryTime,
        entryCandleIndex: this.currentPosition.entryCandleIndex,
        exitTime: candle.time,
        exitReason: exitReason,
        commissions: (entryCommissionPaid || 0) + exitCommission,
        virtualBalanceAfter: this.tradeSettings.virtualBalance
    };

    this.trades.push(trade);
    const positionSnapshot = {
        entryPrice: trade.entryPrice,
        entryTime: trade.entryTime,
        entryCandleIndex: trade.entryCandleIndex,
        positionSize: trade.positionSize
    };

    this.showTradeNotification(trade, false);
    const markerType = exitReason === 'take profit' ? 'take-profit' :
        exitReason === 'stop loss' ? 'stop-loss' : 'sell';
    const labelText = `${exitReason.toUpperCase()} @ ${exitPrice.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`;
    this.addTradeMarker(candle.time, exitPrice, markerType, labelText);
    this.addTradeLine(positionSnapshot, candle, exitPrice);

    // Clear position
    this.currentPosition = null;

    this.updateTradeList();
    this.updatePerformanceMetrics();
    this.saveTradeData();
}

    updatePerformanceMetrics() {
    if (!Array.isArray(this.trades) || this.trades.length === 0) {
        this.performanceMetrics = {
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            winRate: 0,
            totalPnl: 0,
            maxDrawdown: 0,
            profitFactor: 0,
            averageTradeDuration: 0
        };
        this.updatePerformanceUI();
        return;
    }

    let totalProfit = 0;
    let totalLoss = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let tradeDurations = [];

    let startingBalance = this.tradeSettings.startingBalance || 25000;
    let equityCurve = [startingBalance];
    let peakEquity = startingBalance;
    let maxDrawdown = 0;

    const sortedTrades = [...this.trades].sort((a, b) => new Date(a.entryTime) - new Date(b.entryTime));

    sortedTrades.forEach(trade => {
        // Remove the dollar price multiplication here since pnlAmount is already in dollars
        const pnlAmount = trade.pnlAmount; 
        
        if (pnlAmount >= 0) {
            winningTrades++;
            totalProfit += pnlAmount;
        } else {
            losingTrades++;
            totalLoss += Math.abs(pnlAmount);
        }

        const currentEquity = equityCurve[equityCurve.length - 1] + pnlAmount;
        equityCurve.push(currentEquity);

        if (currentEquity > peakEquity) {
            peakEquity = currentEquity;
        }

        const drawdown = ((peakEquity - currentEquity) / peakEquity) * 100;
        if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown;
        }

        const durationHours = (new Date(trade.exitTime) - new Date(trade.entryTime)) / (1000 * 60 * 60);
        tradeDurations.push(durationHours);
    });

    const totalTrades = sortedTrades.length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : (totalProfit > 0 ? Infinity : 0);
    const avgDuration = tradeDurations.length > 0
         ? tradeDurations.reduce((a, b) => a + b, 0) / tradeDurations.length
         : 0;

    this.performanceMetrics = {
        totalTrades,
        winningTrades,
        losingTrades,
        winRate,
        totalPnl: equityCurve[equityCurve.length - 1] - startingBalance,
        maxDrawdown,
        profitFactor,
        averageTradeDuration: avgDuration
    };

    this.updatePerformanceUI();
}

    updatePerformanceUI() {
        const metrics = this.performanceMetrics;
        const balance = this.tradeSettings.virtualBalance;
        // Format values properly
        document.getElementById('total-trades').textContent = metrics.totalTrades;
        document.getElementById('win-rate').textContent = metrics.winRate.toFixed(2) + '%';
        document.getElementById('profit-factor').textContent = metrics.profitFactor === Infinity ?
            '∞' : metrics.profitFactor.toFixed(2);

        // Format P/L with proper sign and color
        const totalPnlElement = document.getElementById('total-pnl');
        const pnlText = metrics.totalPnl >= 0 ?
`+${metrics.totalPnl.toFixed(2)}` :
            metrics.totalPnl.toFixed(2);
        totalPnlElement.textContent = pnlText;
        totalPnlElement.className = metrics.totalPnl >= 0 ? 'up' : 'down';

        // Format max drawdown (should never be negative)
        document.getElementById('max-drawdown').textContent =
            Math.max(0, metrics.maxDrawdown).toFixed(2) + '%';

        // Virtual balance should show current balance, not starting balance
        document.getElementById('virtual-balance').textContent = balance.toFixed(2);
    }

    detectCandlestickPatterns(data) {
        for (let i = 2; i < data.length; i++) {
            const current = data[i];
            const previous = data[i - 1];
            const twoBefore = data[i - 2];

            // Reset pattern
            current.pattern = null;
            current.patternStrength = 0; // 0=normal, 1=weak, 2=strong

            // Calculate candle metrics
            const currentBody = Math.abs(current.close - current.open);
            const currentRange = current.high - current.low;
            const currentBodyRatio = currentRange > 0 ? currentBody / currentRange : 0;
            const prevRange = previous.high - previous.low;

            // Bullish Engulfing (Strong)
            if (
                current.close > current.open &&
                previous.close < previous.open &&
                current.open < previous.close &&
                current.close > previous.open) {
                current.pattern = 'bullish-engulfing';
                current.patternStrength = 2;
            }
            // Bearish Engulfing (Strong)
            else if (
                current.close < current.open &&
                previous.close > previous.open &&
                current.open > previous.close &&
                current.close < previous.open) {
                current.pattern = 'bearish-engulfing';
                current.patternStrength = 2;
            } else {
                const lowerShadow = current.open > current.close ? current.close - current.low : current.open - current.low;
                const upperShadow = current.high - Math.max(current.open, current.close);

                // Hammer (Bullish)
                if (
                    lowerShadow >= 2 * currentBody &&
                    upperShadow <= currentBody * 0.5 &&
                    current.close > current.open &&
                    currentBodyRatio > 0.1) {
                    current.pattern = 'hammer';
                    current.patternStrength = 1;
                }
                // Shooting Star (Bearish)
                else if (
                    upperShadow >= 2 * currentBody &&
                    lowerShadow <= currentBody * 0.5 &&
                    current.close < current.open &&
                    currentBodyRatio > 0.1) {
                    current.pattern = 'shooting-star';
                    current.patternStrength = 1;
                }
                // Morning Star (Strong Bullish)
                else if (
                    twoBefore.close < twoBefore.open &&
                    Math.abs(previous.close - previous.open) < prevRange * 0.3 &&
                    current.close > current.open &&
                    current.close > twoBefore.open) {
                    current.pattern = 'morning-star';
                    current.patternStrength = 2;
                }
                // Evening Star (Strong Bearish)
                else if (
                    twoBefore.close > twoBefore.open &&
                    Math.abs(previous.close - previous.open) < prevRange * 0.3 &&
                    current.close < current.open &&
                    current.close < twoBefore.open) {
                    current.pattern = 'evening-star';
                    current.patternStrength = 2;
                }
                // Piercing Line (Bullish)
                else if (
                    previous.close < previous.open &&
                    current.close > current.open &&
                    current.open < previous.low &&
                    current.close > (previous.open + previous.close) / 2) {
                    current.pattern = 'piercing-line';
                    current.patternStrength = 1;
                }
                // Dark Cloud Cover (Bearish)
                else if (
                    previous.close > previous.open &&
                    current.close < current.open &&
                    current.open > previous.high &&
                    current.close < (previous.open + previous.close) / 2) {
                    current.pattern = 'dark-cloud';
                    current.patternStrength = 1;
                }
                // Three White Soldiers (Strong Bullish)
                else if (
                    i >= 3 &&
                    data[i - 2].close > data[i - 2].open &&
                    previous.close > previous.open &&
                    current.close > current.open &&
                    current.close > previous.close &&
                    previous.close > data[i - 2].close &&
                    current.open > previous.open &&
                    previous.open > data[i - 2].open) {
                    current.pattern = 'three-white-soldiers';
                    current.patternStrength = 2;
                }
                // Three Black Crows (Strong Bearish)
                else if (
                    i >= 3 &&
                    data[i - 2].close < data[i - 2].open &&
                    previous.close < previous.open &&
                    current.close < current.open &&
                    current.close < previous.close &&
                    previous.close < data[i - 2].close &&
                    current.open < previous.open &&
                    previous.open < data[i - 2].open) {
                    current.pattern = 'three-black-crows';
                    current.patternStrength = 2;
                }
                // Doji (Neutral/Reversal)
                else if (
                    currentBodyRatio < 0.1 &&
                    currentRange > 0 &&
                    (lowerShadow > currentRange * 0.4 || upperShadow > currentRange * 0.4)) {
                    current.pattern = 'doji';
                    current.patternStrength = 1;
                    if (lowerShadow >= currentRange * 0.9) {
                        current.pattern = 'dragonfly-doji';
                        current.patternStrength = 1;
                    } else if (upperShadow >= currentRange * 0.9) {
                        current.pattern = 'gravestone-doji';
                        current.patternStrength = 1;
                    }
                }
                // Tweezer Bottom
                else if (
                    previous.high === current.high &&
                    previous.close < previous.open &&
                    current.close > current.open) {
                    current.pattern = 'tweezer-bottom';
                    current.patternStrength = 1;
                }
                // Tweezer Top
                else if (
                    previous.low === current.low &&
                    previous.close > previous.open &&
                    current.close < current.open) {
                    current.pattern = 'tweezer-top';
                    current.patternStrength = 1;
                }
                // Inverted Hammer (Bullish)
                else if (
                    upperShadow >= 2 * currentBody &&
                    lowerShadow <= currentBody * 0.5 &&
                    current.close > current.open) {
                    current.pattern = 'inverted-hammer';
                    current.patternStrength = 1;
                }
                // Hanging Man (Bearish)
                else if (
                    lowerShadow >= 2 * currentBody &&
                    upperShadow <= currentBody * 0.5 &&
                    current.close < current.open) {
                    current.pattern = 'hanging-man';
                    current.patternStrength = 1;
                }
            }
        }
    }

    checkPositionExitConditions(candle, candleIndex) {
        if (!this.currentPosition)
            return;

        // For long positions
        if (this.currentPosition.type === 'buy') {
            // Check stop loss (price went below our SL level)
            if (candle.low <= this.currentPosition.stopLoss) {
                const exitPrice = this.currentPosition.stopLoss;
                this.closePosition(candle, candleIndex, exitPrice, 'stop loss');
            }
            // Check take profit (price went above our TP level)
            else if (candle.high >= this.currentPosition.takeProfit) {
                const exitPrice = this.currentPosition.takeProfit;
                this.closePosition(candle, candleIndex, exitPrice, 'take profit');
            }
        }
        // For short positions
        else if (this.currentPosition.type === 'sell') {
            // Check stop loss (price went above our SL level)
            if (candle.high >= this.currentPosition.stopLoss) {
                const exitPrice = this.currentPosition.stopLoss;
                this.closePosition(candle, candleIndex, exitPrice, 'stop loss');
            }
            // Check take profit (price went below our TP level)
            else if (candle.low <= this.currentPosition.takeProfit) {
                const exitPrice = this.currentPosition.takeProfit;
                this.closePosition(candle, candleIndex, exitPrice, 'take profit');
            }
        }
    }

    addTradeMarker(time, price, type, labelText) {
        // Define all possible marker types and their colors
        //console.log('Adding trade marker:', { time, price, type, labelText });
        const colors = {
            'buy': {
                bg: '#00c176',
                text: '#fff'
            },
            'sell': {
                bg: '#ff3b30',
                text: '#fff'
            },
            'take-profit': {
                bg: '#4caf50',
                text: '#fff'
            },
            'stop-loss': {
                bg: '#f44336',
                text: '#fff'
            },
            'buy-add': { // Add this for buy additions
                bg: '#00c176',
                text: '#fff'
            },
            'sell-add': { // Add this for sell additions
                bg: '#ff3b30',
                text: '#fff'
            }
        };

        // Default to buy style if type is unknown
        const markerStyle = colors[type] || colors['buy'];

        this.tradeMarkers.push({
            x: new Date(time),
            y: price,
            marker: {
                size: type === 'buy' || type === 'buy-add' ? 10 : 8,
                fillColor: markerStyle.bg,
                strokeColor: '#fff',
                radius: type === 'buy' || type === 'buy-add' ? 6 : 4,
                shape: type.includes('buy') ? 'triangle' : 'invertedTriangle',
                cssClass: `apexcharts-trade-marker apexcharts-trade-marker-${type}`
            },
            label: {
                text: labelText,
                style: {
                    color: markerStyle.text,
                    background: markerStyle.bg,
                    fontSize: '12px',
                    cssClass: 'apexcharts-trade-label'
                },
                offsetY: type.includes('buy') ? -20 : 20
            }
        });
    }

    addTradeLine(position, exitCandle, exitPrice) {
        try {
            // Check if position and required properties exist
            if (!position || !exitCandle || typeof position.entryCandleIndex === 'undefined') {
                console.warn('Invalid position or exit candle data - cannot add trade line');
                return;
            }

            const entryCandle = this.data[position.entryCandleIndex];

            // Additional safety check
            if (!entryCandle) {
                console.warn('Entry candle not found in data array');
                return;
            }

            const pnlPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
            const isProfit = pnlPercent >= 0;

            // Calculate line coordinates with visual offsets to avoid marker overlap
            const entryX = new Date(entryCandle.time);
            const exitX = new Date(exitCandle.time);

            // Adjust y-position slightly to make lines more visible on candles
            const entryY = position.entryPrice * (isProfit ? 0.998 : 1.002);
            const exitY = exitPrice * (isProfit ? 1.002 : 0.998);

            // Dynamic line width based on position size (relative to max position size)
            const maxPositionSize = this.trades.length > 0
                 ? Math.max(...this.trades.map(t => t.positionSize), position.positionSize)
                 : position.positionSize;

            const lineWidth = 1 + (3 * (position.positionSize / maxPositionSize));

            // Calculate optimal label position
            const labelPosition = (exitX - entryX) / (1000 * 60 * 60) > 2 ? 'center' : 'right';

            this.tradeLines.push({
                x: entryX,
                y: entryY,
                x2: exitX,
                y2: exitY,
                strokeDashArray: 0,
                borderColor: isProfit ? '#00c176' : '#ff3b30',
                strokeWidth: lineWidth,
                opacity: 0.8,
                label: {
                    text: `${isProfit ? '+' : ''}${pnlPercent.toFixed(2)}%`,
                    borderColor: isProfit ? '#00c176' : '#ff3b30',
                    offsetY: isProfit ? -10 : 10,
                    style: {
                        color: '#fff',
                        background: isProfit ? '#00c176' : '#ff3b30',
                        fontSize: '12px',
                        padding: {
                            left: 6,
                            right: 6,
                            top: 2,
                            bottom: 2
                        },
                        borderRadius: '4px'
                    },
                    position: labelPosition,
                    textAnchor: 'middle'
                }
            });

            // Add small markers at line ends for better visibility
            this.tradeMarkers.push({
                x: entryX,
                y: entryY,
                marker: {
                    size: 4,
                    fillColor: isProfit ? '#00c176' : '#ff3b30',
                    strokeColor: '#fff',
                    radius: 2
                }
            });

            this.tradeMarkers.push({
                x: exitX,
                y: exitY,
                marker: {
                    size: 4,
                    fillColor: isProfit ? '#00c176' : '#ff3b30',
                    strokeColor: '#fff',
                    radius: 2
                }
            });
        } catch (error) {
            console.error('Error adding trade line:', error);
        }
    }

    // Add this new method
    updateTradeList() {
        const tradeListBody = document.getElementById('trade-list-body');

        // Clear existing trades
        tradeListBody.innerHTML = '';

        // Sort trades by entry time (oldest first)
        const sortedTrades = [...this.trades].sort((a, b) =>
            new Date(a.entryTime) - new Date(b.entryTime));

        // Add completed trades (now sorted)
        sortedTrades.forEach((trade, index) => {
            const row = document.createElement('tr');
            const pnlClass = trade.pnlAmount >= 0 ? 'trade-profit' : 'trade-loss';
            const exitReason = trade.exitReason === 'signal' ? '' : ` (${trade.exitReason})`;
            const durationMinutes = (new Date(trade.exitTime) - new Date(trade.entryTime)) / 1000 / 60;

            row.innerHTML = `
        <td>${index + 1}</td>
        <td>${trade.type.toUpperCase()}</td>
        <td>${trade.entryPrice.toFixed(2)}<br>
            <small>${new Date(trade.entryTime).toLocaleString()}</small></td>
        <td>${trade.exitPrice.toFixed(2)}${exitReason}<br>
            <small>${new Date(trade.exitTime).toLocaleString()}</small></td>
        <td>${trade.positionSize.toFixed(6)}</td>
        <td class="${pnlClass}">${trade.pnlAmount >= 0 ? '+' : ''}${(trade.pnlAmount).toFixed(2)}</td>
        <td class="${pnlClass}">${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}%</td>
        <td>${Math.floor(durationMinutes)} mins</td>
    `;

            tradeListBody.appendChild(row);
        });

        // Add current running trade if exists
        if (this.currentPosition) {
            const row = document.createElement('tr');
            row.classList.add('running-trade');
            const durationMinutes = (new Date() - new Date(this.currentPosition.entryTime)) / 1000 / 60;
            if (this.data[this.data.length - 1]) {
                const currentPrice = this.data[this.data.length - 1].close;

                // Calculate PnL based on position type
                let pnlPercent,
                pnlAmount;
                if (this.currentPosition.type === 'buy') {
                    pnlPercent = ((currentPrice - this.currentPosition.entryPrice) / this.currentPosition.entryPrice) * 100;
                    pnlAmount = this.currentPosition.positionSize * (currentPrice - this.currentPosition.entryPrice) * this.tradeSettings.dollerPrice;
                } else {
                    pnlPercent = ((this.currentPosition.entryPrice - currentPrice) / this.currentPosition.entryPrice) * 100;
                    pnlAmount = this.currentPosition.positionSize * (this.currentPosition.entryPrice - currentPrice) * this.tradeSettings.dollerPrice;
                }

                // Format SL and TP prices
                const slPrice = this.currentPosition.stopLoss.toFixed(2);
                const tpPrice = this.currentPosition.takeProfit.toFixed(2);

                // Calculate distance to SL and TP in percentage
                const slDistancePct = this.currentPosition.type === 'buy'
                     ? ((this.currentPosition.entryPrice - this.currentPosition.stopLoss) / this.currentPosition.entryPrice * 100).toFixed(2)
                     : ((this.currentPosition.stopLoss - this.currentPosition.entryPrice) / this.currentPosition.entryPrice * 100).toFixed(2);

                const tpDistancePct = this.currentPosition.type === 'buy'
                     ? ((this.currentPosition.takeProfit - this.currentPosition.entryPrice) / this.currentPosition.entryPrice * 100).toFixed(2)
                     : ((this.currentPosition.entryPrice - this.currentPosition.takeProfit) / this.currentPosition.entryPrice * 100).toFixed(2);

                row.innerHTML = `
            <td>${sortedTrades.length + 1}</td>
            <td>${this.currentPosition.type.toUpperCase()}</td>
            <td>${this.currentPosition.entryPrice.toFixed(2)}<br>
                <small>${new Date(this.currentPosition.entryTime).toLocaleString()}</small></td>
            <td><em>Running...</em>
                <small>Current: ${currentPrice.toFixed(2)}</small>
                <small class="sl-info">SL: ${slPrice} (${slDistancePct}%)</small>
                <small class="tp-info">TP: ${tpPrice} (${tpDistancePct}%)</small>
            </td>
            <td>${this.currentPosition.positionSize.toFixed(6)}</td>
            <td class="${pnlAmount >= 0 ? 'trade-profit' : 'trade-loss'}">${pnlAmount >= 0 ? '+' : ''}${pnlAmount.toFixed(2)}</td>
            <td class="${pnlPercent >= 0 ? 'trade-profit' : 'trade-loss'}">${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%</td>
            <td>${Math.floor(durationMinutes)} mins</td>
        `;

                tradeListBody.appendChild(row);
            }
        }

        this.previousPair = this.pair;
    }
    // Add these methods to the CandleChart class

    getTradeHistoryPath() {
        return localStorage.getItem('tradeHistoryPath') || './trade_history/';
    }

    getTradeHistoryFilename() {
        return `${this.getTradeHistoryPath()}trade_history_${this.pair}.csv`;
    }

    parseLastTradeBalance(csvContent) {
        const lines = csvContent.trim().split('\n');
        if (lines.length < 2)
            return this.tradeSettings.virtualBalance;

        const lastLine = lines[lines.length - 1];
        const values = lastLine.split(',');
        return parseFloat(values[values.length - 1]) || this.tradeSettings.virtualBalance;
    }

    recreateTradeVisuals() {
        this.tradeMarkers = [];
        this.tradeLines = [];

        this.trades.forEach(trade => {
            // Find corresponding candles in current data
            const entryCandle = this.data.find(c =>
                    new Date(c.time).getTime() === new Date(trade.entryTime).getTime());
            const exitCandle = this.data.find(c =>
                    new Date(c.time).getTime() === new Date(trade.exitTime).getTime());

            if (entryCandle) {
                // Add entry marker
                this.addTradeMarker(
                    trade.entryTime,
                    trade.entryPrice,
                    trade.type,
`${trade.type.toUpperCase()} @ ${trade.entryPrice.toFixed(2)}`);

                if (exitCandle) {
                    // Add exit marker
                    const exitType = trade.exitReason === 'take profit' ? 'take-profit' :
                        trade.exitReason === 'stop loss' ? 'stop-loss' : 'sell';
                    this.addTradeMarker(
                        trade.exitTime,
                        trade.exitPrice,
                        exitType,
`${trade.exitReason.toUpperCase()} @ ${trade.exitPrice.toFixed(2)} (${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}%)`);

                    // Add trade line
                    this.addTradeLine({
                        entryPrice: trade.entryPrice,
                        entryTime: trade.entryTime,
                        entryCandleIndex: this.data.indexOf(entryCandle),
                        positionSize: trade.positionSize
                    }, exitCandle, trade.exitPrice);
                }
            }
        });

        this.updateTradeList();
        this.updatePerformanceMetrics();
        this.updateChart();
    }
    initChart() {
        const chartOptions = {
            series: [],
            chart: {
                type: 'candlestick',
                height: 450,
                toolbar: {
                    show: true
                },
                zoom: {
                    enabled: true
                },
                animations: {
                    enabled: true
                },
                fontFamily: 'inherit'
            },
            plotOptions: {
                candlestick: {
                    colors: {
                        upward: '#00c176',
                        downward: '#ff3b30'
                    },
                    wick: {
                        useFillColor: true
                    }
                }
            },
            xaxis: {
                type: 'datetime',
                labels: {
                    formatter: (value) => {
                        return this.formatTimeForTimeframe(new Date(value));
                    },
                    style: {
                        colors: '#a1a9bb',
                        fontSize: '12px'
                    }
                },
                axisBorder: {
                    show: true,
                    color: '#2a3241'
                },
                axisTicks: {
                    show: true,
                    color: '#2a3241'
                }
            },
            // Add to your chart options in initChart()
            yaxis: {
                labels: {
                    formatter: function (val) {
                        return val.toFixed(2);
                    },
                    style: {
                        colors: '#e0e3eb',
                        fontSize: '11px'
                    }
                },
                axisBorder: {
                    show: true,
                    color: '#2a3241'
                },
                tooltip: {
                    enabled: true
                },
                crosshairs: {
                    show: true,
                    position: 'back',
                    stroke: {
                        color: '#3a7bd5',
                        width: 1,
                        dashArray: 0
                    }
                }
            },
            tooltip: {
                enabled: true,
                shared: true,
                intersect: false,
                custom: ({
                    series,
                    seriesIndex,
                    dataPointIndex,
                    w
                }) => {
                    // Get the candle data for the hovered point
                    const hoveredCandle = this.data[dataPointIndex];
                    if (hoveredCandle) {
                        this.updateInfoPanel(hoveredCandle);
                    }
                    return '';
                }
            },
            grid: {
                show: true,
                borderColor: '#2a3241',
                strokeDashArray: 0,
                position: 'back'
            },
            annotations: {
                points: []
            },
            stroke: {
                width: [2, 1, 1]
            }
        };

        this.chart = new ApexCharts(document.querySelector("#chart"), chartOptions);
        this.chart.render();
    }
    // Add this method to your CandleChart class
    showTradeNotification(trade, isEntry) {
        if (!this.notificationContainer)
            this.initNotifications();

        const isBuy = trade.type === 'buy';
        const action = isEntry ? 'Executed' : 'Completed';
        const title = `${isBuy ? 'BUY' : 'SELL'} ${action}`;
        const color = isBuy ? '#00c176' : '#ff3b30';
        const icon = isBuy ? '💰' : '💸';

        const pnlText = !isEntry && trade.pnlPercent
             ? ` (${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}%)`
             : '';

        const price = isEntry ? trade.entryPrice : trade.exitPrice;
        const time = new Date().toLocaleTimeString();

        const notification = document.createElement('div');
        notification.className = 'candle-notification';
        notification.style.backgroundColor = '#1E1E1E';
        notification.style.color = 'white';
        notification.style.padding = '15px';
        notification.style.borderRadius = '8px';
        notification.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        notification.style.borderLeft = `4px solid ${color}`;
        notification.style.transform = 'translateX(120%)';
        notification.style.transition = 'transform 0.3s ease-out';
        notification.style.position = 'relative';
        notification.style.overflow = 'hidden';

        notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <div style="font-size: 24px; color: ${color}">${icon}</div>
            <div style="flex: 1;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <div style="font-weight: 600; font-size: 15px;">${title}</div>
                    <div style="font-weight: bold; font-size: 14px; color: ${color}">
                        ${isBuy ? 'BUY' : 'SELL'} ${pnlText}
                    </div>
                </div>
                <div style="font-size: 13px; opacity: 0.8; margin-bottom: 6px;">
                    ${isEntry ? 'New position opened' : 'Position closed'} ${!isEntry ? trade.exitReason : ''}
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 12px;">
                    <div style="opacity: 0.7;">${this.pair} • ${price.toFixed(2)}</div>
                </div>
				<div style="display: flex; justify-content: space-between; font-size: 12px;">
				<div style="opacity: 0.6;">${time}</div>
				</div>
            </div>
        </div>
        <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, ${color}, transparent);"></div>
    `;

        this.notificationContainer.prepend(notification);

        // Trigger the slide-in animation
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 10);

        // Auto-remove after 15 seconds
        setTimeout(() => {
            notification.style.transform = 'translateX(120%)';
            setTimeout(() => notification.remove(), 300);
        }, 15000);

        // Add click to dismiss
        notification.addEventListener('click', () => {
            notification.style.transform = 'translateX(120%)';
            setTimeout(() => notification.remove(), 300);
        });
    }
    // Add these methods to the CandleChart class
    downloadTradeHistory() {
        if (this.trades.length === 0) {
            alert('No trade history to download');
            return;
        }

        const headers = [
            'Type', 'EntryPrice', 'ExitPrice', 'PositionSize', 'P/LAmount',
            'P/LPercent', 'EntryTime', 'ExitTime', 'DurationMins',
            'ExitReason', 'Commissions', 'VirtualBalanceAfter'
        ];

        // Calculate running balance
        let runningBalance = this.tradeSettings.virtualBalance;
        const tradesWithBalance = [...this.trades]
        .sort((a, b) => new Date(a.entryTime) - new Date(b.entryTime))
        .map(trade => ({
                ...trade,
                virtualBalanceAfter: runningBalance
            }));

        // Create CSV content
        let csvContent = headers.join(',') + '\n';
        tradesWithBalance.forEach(trade => {
            const durationMinutes = (new Date(trade.exitTime) - new Date(trade.entryTime)) / (1000 * 60);
            const row = [
                trade.type.toUpperCase(),
                trade.entryPrice.toFixed(8),
                trade.exitPrice.toFixed(8),
                trade.positionSize.toFixed(8),
                trade.pnlAmount.toFixed(2),
                trade.pnlPercent.toFixed(2),
                new Date(trade.entryTime).toISOString(),
                new Date(trade.exitTime).toISOString(),
                durationMinutes.toFixed(0),
                trade.exitReason,
                trade.commissions.toFixed(2),
                trade.virtualBalanceAfter.toFixed(2)
            ].join(',');
            csvContent += row + '\n';
        });

        // Create download link
        const blob = new Blob([csvContent], {
            type: 'text/csv;charset=utf-8;'
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `trade_history_${this.pair}_${new Date().toISOString().slice(0,10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    handleTradeHistoryUpload(event) {
        const file = event.target.files[0];
        if (!file)
            return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const csvData = e.target.result;
                this.parseAndLoadTradeHistory(csvData);
            } catch (error) {
                console.error('Error parsing CSV file:', error);
                alert('Error parsing CSV file. Please check the format.');
            }
        };
        reader.readAsText(file);
    }

    parseAndLoadTradeHistory(csvData) {
        const lines = csvData.trim().split('\n');
        if (lines.length < 2) {
            alert('CSV file is empty or invalid');
            return;
        }

        const headers = lines[0].split(',');
        this.trades = [];

        // Find the indices of each column
        const typeIndex = headers.indexOf('Type');
        const entryPriceIndex = headers.indexOf('EntryPrice');
        const exitPriceIndex = headers.indexOf('ExitPrice');
        const positionSizeIndex = headers.indexOf('PositionSize');
        const pnlAmountIndex = headers.indexOf('P/LAmount');
        const pnlPercentIndex = headers.indexOf('P/LPercent');
        const entryTimeIndex = headers.indexOf('EntryTime');
        const exitTimeIndex = headers.indexOf('ExitTime');
        const exitReasonIndex = headers.indexOf('ExitReason');
        const commissionsIndex = headers.indexOf('Commissions');
        const balanceIndex = headers.indexOf('VirtualBalanceAfter');

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i])
                continue;

            const values = lines[i].split(',');
            if (values.length < headers.length)
                continue;

            const trade = {
                type: values[typeIndex].toLowerCase(),
                entryPrice: parseFloat(values[entryPriceIndex]),
                exitPrice: parseFloat(values[exitPriceIndex]),
                positionSize: parseFloat(values[positionSizeIndex]),
                pnlAmount: parseFloat(values[pnlAmountIndex]),
                pnlPercent: parseFloat(values[pnlPercentIndex]),
                entryTime: values[entryTimeIndex],
                exitTime: values[exitTimeIndex],
                exitReason: values[exitReasonIndex] ? values[exitReasonIndex].toLowerCase() : 'signal',
                commissions: parseFloat(values[commissionsIndex] || 0)
            };

            this.trades.push(trade);
        }

        // Update virtual balance from last trade if available
        if (this.trades.length > 0 && balanceIndex !== -1) {
            const lastLine = lines[lines.length - 1];
            const lastValues = lastLine.split(',');
            if (lastValues[balanceIndex]) {
                this.tradeSettings.virtualBalance = parseFloat(lastValues[balanceIndex]);
            }
        }

        this.recreateTradeVisuals();
        alert(`Successfully loaded ${this.trades.length} trades from CSV`);
    }

    initEventListeners() {
        // Timeframe dropdown
        document.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Remove active class from all items
                document.querySelectorAll('.dropdown-item').forEach(i => {
                    i.classList.remove('active');
                });

                // Add active class to clicked item
                e.target.classList.add('active');

                // Update displayed timeframe
                document.getElementById('current-timeframe').textContent =
                    e.target.dataset.timeframe;

                // Set the timeframe and reload data
                this.timeframe = e.target.dataset.timeframe;
                this.loadData();
            });
        });

        // Market pair selector
        document.getElementById('marketPair').addEventListener('change', (e) => {
            this.saveTradeData();
            this.loadTradeData();
            // Reset trade history when pair changes
            if (this.pair !== e.target.value) {
                this.trades = [];
                this.currentPosition = null;
            }
            this.pair = e.target.value;
            this.loadData();
        });

        // Indicator controls
        document.getElementById('supertrend-toggle').addEventListener('change', (e) => {
            this.indicators.supertrend.enabled = e.target.checked;
            this.loadData();
        });

        document.getElementById('supertrend-period').addEventListener('change', (e) => {
            this.indicators.supertrend.period = parseInt(e.target.value);
            this.loadData();
        });

        document.getElementById('supertrend-multiplier').addEventListener('change', (e) => {
            this.indicators.supertrend.multiplier = parseFloat(e.target.value);
            this.loadData();
        });

        document.getElementById('rsi-toggle').addEventListener('change', (e) => {
            this.indicators.rsi.enabled = e.target.checked;
            this.loadData();
        });

        document.getElementById('rsi-period').addEventListener('change', (e) => {
            this.indicators.rsi.period = parseInt(e.target.value);
            this.loadData();
        });

        document.getElementById('rsi-overbought').addEventListener('change', (e) => {
            this.indicators.rsi.overbought = parseInt(e.target.value);
            this.loadData();
        });

        document.getElementById('rsi-oversold').addEventListener('change', (e) => {
            this.indicators.rsi.oversold = parseInt(e.target.value);
            this.loadData();
        });

        document.getElementById('macd-toggle').addEventListener('change', (e) => {
            this.indicators.macd.enabled = e.target.checked;
            this.loadData();
        });

        document.getElementById('macd-fast').addEventListener('change', (e) => {
            this.indicators.macd.fastPeriod = parseInt(e.target.value);
            this.loadData();
        });

        document.getElementById('macd-slow').addEventListener('change', (e) => {
            this.indicators.macd.slowPeriod = parseInt(e.target.value);
            this.loadData();
        });

        document.getElementById('macd-signal').addEventListener('change', (e) => {
            this.indicators.macd.signalPeriod = parseInt(e.target.value);
            this.loadData();
        });
        // Add to initEventListeners method
        document.getElementById('download-trades-btn').addEventListener('click', () => {
            this.downloadTradeHistory();
        });

        document.getElementById('trade-history-upload').addEventListener('change', (e) => {
            this.handleTradeHistoryUpload(e);
            e.target.value = ''; // Reset input to allow re-uploading same file
        });

        document.getElementById('supertrend-toggle').addEventListener('change', (e) => {
            this.indicators.supertrend.enabled = e.target.checked;
            this.updateChart(); // Changed from loadData()
        });

        document.getElementById('rsi-toggle').addEventListener('change', (e) => {
            this.indicators.rsi.enabled = e.target.checked;
            this.updateChart(); // Changed from loadData()
        });

        document.getElementById('macd-toggle').addEventListener('change', (e) => {
            this.indicators.macd.enabled = e.target.checked;
            this.updateChart(); // Changed from loadData()
        });

        document.getElementById('chart').addEventListener('mouseleave', () => {
            this.updateInfoPanel(); // Reset to show latest candle values
        });
        // Add to initEventListeners():
        document.getElementById('clear-trades-btn').addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all trade history for this pair?')) {
                localStorage.removeItem(`tradeData_${this.pair}`);
                this.trades = [];
                this.currentPosition = null;
                this.tradeSettings.virtualBalance = 25000;
                this.updatePerformanceMetrics();
                this.updateTradeList();
                this.updateChart();
            }
        });
    }

    startAutoRefresh() {
        if (this.refreshInterval)
            clearInterval(this.refreshInterval);
        this.refreshInterval = setInterval(() => this.loadData(), 10000);
    }

    async loadData(limit = 120) {
        try {
            const binanceTimeframe = this.binanceTimeframes[this.timeframe] || '15m';
            const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${this.pair}&interval=${binanceTimeframe}&limit=${limit}`);
            let binanceData = await response.json();

            if (!binanceData || binanceData.length === 0) {
                throw new Error('No data received from Binance API');
            }

            // Convert Binance format to our expected format
            const newData = binanceData.map(item => ({
                        time: item[0],
                        open: parseFloat(item[1]),
                        high: parseFloat(item[2]),
                        low: parseFloat(item[3]),
                        close: parseFloat(item[4]),
                        volume: parseFloat(item[5]),
                        vwap: 0, // Initialize VWAP
                        volumeMA: 0, // Initialize Volume MA
                        ema20: 0, // Initialize EMA20
                        ema50: 0 // Initialize EMA50
                    }));

            // Sort in ascending order (oldest first)
            newData.sort((a, b) => a.time - b.time);

            this.detectCandlestickPatterns(newData);
            // Check if we have a new candle with a pattern
            if (this.data.length > 0 && newData.length > 0) {
                const lastOldCandle = this.data[this.data.length - 1];
                const newCandle = newData.find(c => c.time > lastOldCandle.time);

                if (newCandle && newCandle.pattern) {
                    this.showNotification(newCandle.pattern, newCandle);
                }
            }
            // Calculate indicators
            this.calculateSupertrend(newData);
            this.calculateRSI(newData);
            this.calculateMACD(newData);
            this.calculateVWAP(newData); // NEW: VWAP
            this.calculateVolumeMA(newData, 20); // NEW: Volume MA (20-period)
            this.calculateSupportResistance(newData);
            // Calculate EMAs
            for (let i = 0; i < newData.length; i++) {
                newData[i].ema20 = this.calculateEMA(newData, 20, i);
                newData[i].ema50 = this.calculateEMA(newData, 50, i);
            }
            this.detectSignals(newData);
            this.simulateTrades(newData);
            this.data = newData;
            this.updateChart();
            this.updateInfoPanel();
            this.updateCurrentPrice();
            this.updateTradeList();
            this.updatePerformanceMetrics();
        } catch (error) {
            console.error('Error loading candle data:', error);
            if (!this.refreshInterval) {
                alert(`Error loading data: ${error.message}`);
            }
        }
    }

    calculateVWAP(data) {
        let cumulativePV = 0; // Price × Volume
        let cumulativeVolume = 0;

        for (let i = 0; i < data.length; i++) {
            const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3;
            cumulativePV += typicalPrice * data[i].volume;
            cumulativeVolume += data[i].volume;
            data[i].vwap = cumulativeVolume > 0 ? (cumulativePV / cumulativeVolume) : 0;
        }
    }

    calculateVolumeMA(data, period = 20) {
        for (let i = period - 1; i < data.length; i++) {
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += data[i - j].volume;
            }
            data[i].volumeMA = sum / period;
        }
    }

    calculateEMA(data, period, index) {
        if (index < period - 1)
            return null;

        // First EMA = SMA (Simple Moving Average)
        if (index === period - 1) {
            let sum = 0;
            for (let i = 0; i < period; i++) {
                sum += data[index - i].close;
            }
            return sum / period;
        }

        // Subsequent EMAs use smoothing
        const multiplier = 2 / (period + 1);
        const prevEMA = data[index - 1][`ema${period}`] || this.calculateEMA(data, period, index - 1);
        return (data[index].close - prevEMA) * multiplier + prevEMA;
    }

    calculateSupertrend(data) {
        if (!this.indicators.supertrend.enabled)
            return;

        const period = this.indicators.supertrend.period;
        const multiplier = this.indicators.supertrend.multiplier;

        // Calculate True Range (TR)
        for (let i = 1; i < data.length; i++) {
            const tr = Math.max(
                    data[i].high - data[i].low,
                    Math.abs(data[i].high - data[i - 1].close),
                    Math.abs(data[i].low - data[i - 1].close));
            data[i].tr = tr;
        }

        // Calculate ATR
        for (let i = period; i < data.length; i++) {
            // First ATR is simple average of first 'period' TR values
            if (i === period) {
                let sumTR = 0;
                for (let j = 1; j <= period; j++) {
                    sumTR += data[j].tr;
                }
                data[i].atr = sumTR / period;
            }
            // Subsequent ATR values use Wilder's smoothing method
            else {
                data[i].atr = ((data[i - 1].atr * (period - 1)) + data[i].tr) / period;
            }
        }

        // Calculate Supertrend
        for (let i = period; i < data.length; i++) {
            const hl2 = (data[i].high + data[i].low) / 2;
            const basicUpper = hl2 + (multiplier * data[i].atr);
            const basicLower = hl2 - (multiplier * data[i].atr);

            // Initialize first value
            if (i === period) {
                data[i].supertrendUpper = basicUpper;
                data[i].supertrendLower = basicLower;
                data[i].supertrendDirection = data[i].close > basicUpper ? 'up' : 'down';
                continue;
            }

            // Current upper band
            if (data[i - 1].supertrendDirection === 'up') {
                data[i].supertrendUpper = Math.min(basicUpper, data[i - 1].supertrendUpper);
            } else {
                data[i].supertrendUpper = basicUpper;
            }

            // Current lower band
            if (data[i - 1].supertrendDirection === 'down') {
                data[i].supertrendLower = Math.max(basicLower, data[i - 1].supertrendLower);
            } else {
                data[i].supertrendLower = basicLower;
            }

            // Determine direction
            if (data[i].close > data[i].supertrendUpper) {
                data[i].supertrendDirection = 'up';
            } else if (data[i].close < data[i].supertrendLower) {
                data[i].supertrendDirection = 'down';
            } else {
                // Maintain previous direction
                data[i].supertrendDirection = data[i - 1].supertrendDirection;

                // Adjust bands to be more responsive
                if (data[i].supertrendDirection === 'up') {
                    data[i].supertrendLower = Math.max(data[i].supertrendLower, data[i - 1].supertrendLower);
                } else {
                    data[i].supertrendUpper = Math.min(data[i].supertrendUpper, data[i - 1].supertrendUpper);
                }
            }
        }
    }

    calculateRSI(data) {
        if (!this.indicators.rsi.enabled)
            return;

        const period = this.indicators.rsi.period;

        // First calculate gains and losses
        for (let i = 1; i < data.length; i++) {
            const change = data[i].close - data[i - 1].close;
            data[i].gain = Math.max(change, 0);
            data[i].loss = Math.abs(Math.min(change, 0));
        }

        // Calculate first average gains and losses
        let avgGain = 0;
        let avgLoss = 0;

        for (let i = 1; i <= period; i++) {
            avgGain += data[i].gain;
            avgLoss += data[i].loss;
        }

        avgGain /= period;
        avgLoss /= period;

        data[period].avgGain = avgGain;
        data[period].avgLoss = avgLoss;
        data[period].rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

        // Calculate subsequent RSI values
        for (let i = period + 1; i < data.length; i++) {
            data[i].avgGain = ((period - 1) * data[i - 1].avgGain + data[i].gain) / period;
            data[i].avgLoss = ((period - 1) * data[i - 1].avgLoss + data[i].loss) / period;

            const rs = data[i].avgLoss === 0 ? Infinity : data[i].avgGain / data[i].avgLoss;
            data[i].rsi = 100 - (100 / (1 + rs));
        }
    }

    calculateMACD(data) {
        if (!this.indicators.macd.enabled)
            return;

        const fastPeriod = this.indicators.macd.fastPeriod;
        const slowPeriod = this.indicators.macd.slowPeriod;
        const signalPeriod = this.indicators.macd.signalPeriod;

        // Initialize EMAs
        let emaFast = 0;
        let emaSlow = 0;
        let emaSignal = 0;
        let macdValues = []; // Array to store MACD values for signal calculation

        for (let i = 0; i < data.length; i++) {
            // Calculate initial SMA for fast EMA
            if (i === fastPeriod - 1) {
                let sum = 0;
                for (let j = 0; j < fastPeriod; j++) {
                    sum += data[i - j].close;
                }
                emaFast = sum / fastPeriod;
                data[i].emaFast = emaFast;
            }
            // Calculate fast EMA for subsequent periods
            else if (i >= fastPeriod) {
                const multiplier = 2 / (fastPeriod + 1);
                emaFast = (data[i].close - emaFast) * multiplier + emaFast;
                data[i].emaFast = emaFast;
            }

            // Calculate initial SMA for slow EMA
            if (i === slowPeriod - 1) {
                let sum = 0;
                for (let j = 0; j < slowPeriod; j++) {
                    sum += data[i - j].close;
                }
                emaSlow = sum / slowPeriod;
                data[i].emaSlow = emaSlow;
            }
            // Calculate slow EMA for subsequent periods
            else if (i >= slowPeriod) {
                const multiplier = 2 / (slowPeriod + 1);
                emaSlow = (data[i].close - emaSlow) * multiplier + emaSlow;
                data[i].emaSlow = emaSlow;
            }

            // Calculate MACD line (fast EMA - slow EMA)
            if (i >= slowPeriod) {
                data[i].macd = emaFast - emaSlow;
                macdValues.push(data[i].macd); // Store for signal calculation

                // Calculate signal line (EMA of MACD)
                if (i === slowPeriod + signalPeriod - 1) {
                    // First signal value is SMA of MACD values
                    let sum = 0;
                    for (let j = 0; j < signalPeriod; j++) {
                        sum += macdValues[j];
                    }
                    emaSignal = sum / signalPeriod;
                    data[i].signalValue = emaSignal;
                } else if (i > slowPeriod + signalPeriod - 1) {
                    // Subsequent signal values are EMA of MACD
                    const signalMultiplier = 2 / (signalPeriod + 1);
                    emaSignal = (data[i].macd - emaSignal) * signalMultiplier + emaSignal;
                    data[i].signalValue = emaSignal;
                }

                // Calculate histogram (MACD - Signal)
                if (i >= slowPeriod + signalPeriod - 1) {
                    data[i].histogram = data[i].macd - data[i].signalValue;
                }
            }
        }
    }

    calculateSupportResistance(data) {
        if (!this.indicators.supportResistance.enabled)
            return;

        const period = this.indicators.supportResistance.period;

        for (let i = period; i < data.length; i++) {
            // Find support (lowest low in period)
            let support = data[i].low;
            for (let j = i - period + 1; j <= i; j++) {
                if (data[j].low < support) {
                    support = data[j].low;
                }
            }

            // Find resistance (highest high in period)
            let resistance = data[i].high;
            for (let j = i - period + 1; j <= i; j++) {
                if (data[j].high > resistance) {
                    resistance = data[j].high;
                }
            }

            data[i].support = support;
            data[i].resistance = resistance;
        }
    }

    detectSignals(data) {
        const rsiPeriod = this.indicators.rsi.period;
        const macdPeriod = Math.max(this.indicators.macd.fastPeriod, this.indicators.macd.slowPeriod, this.indicators.macd.signalPeriod);
        const supertrendPeriod = this.indicators.supertrend.period;
        const minPeriod = Math.max(rsiPeriod, macdPeriod, supertrendPeriod);
        const MIN_WEIGHTED_SCORE = 4; // aggressive: lower to catch earlier signals
        const MIN_ATR_RATIO = 0.001; // aggressive: allow lower volatility candles

        //console.log(data);
        for (let i = minPeriod; i < data.length; i++) {
            data[i].signal = {
                type: null,
                price: null,
                value: null,
                signalValue: null,
                source: null,
                confidence: 0
            };

            if (i < minPeriod + 3)
                continue; // shave a couple candles for speed (aggressive)

            const rsi = data[i].rsi;
            const macd = data[i].macd;
            const signalVal = data[i].signalValue;
            const ema20 = data[i].ema20,
            ema50 = data[i].ema50;
            const vwap = data[i].vwap,
            volumeMA = data[i].volumeMA;

            const isSupertrendBullish = data[i].supertrendDirection === 'up';
            const isSupertrendBearish = data[i].supertrendDirection === 'down';
            const isRSIBullish = (typeof rsi === 'number') ? (rsi < this.indicators.rsi.oversold) : false;
            const isRSIBearish = (typeof rsi === 'number') ? (rsi > this.indicators.rsi.overbought) : false;
            const isMACDBullish = (typeof macd === 'number' && typeof signalVal === 'number') ? (macd > signalVal) : false;
            const isMACDBearish = (typeof macd === 'number' && typeof signalVal === 'number') ? (macd < signalVal) : false;
            const isVolumeSpiking = (typeof volumeMA === 'number') ? (data[i].volume > volumeMA * 1.4) : false; // slightly looser
            const isAboveVWAP = (typeof vwap === 'number') ? (data[i].close > vwap) : false;
            const isBelowVWAP = (typeof vwap === 'number') ? (data[i].close < vwap) : false;
            const isEMABullish = (typeof ema20 === 'number' && typeof ema50 === 'number') ? (ema20 > ema50) : false;
            const isEMABearish = (typeof ema20 === 'number' && typeof ema50 === 'number') ? (ema20 < ema50) : false;
            const isEMACrossBullish = (typeof ema20 === 'number' && typeof ema50 === 'number') ? (ema20 > ema50 && data[i - 1].ema20 <= data[i - 1].ema50) : false;
            const isEMACrossBearish = (typeof ema20 === 'number' && typeof ema50 === 'number') ? (ema20 < ema50 && data[i - 1].ema20 >= data[i - 1].ema50) : false;
            const isBullishPattern = !!data[i].pattern && ['hammer', 'bullish-engulfing', 'morning-star', 'piercing-line'].includes(data[i].pattern);
            const isBearishPattern = !!data[i].pattern && ['shooting-star', 'bearish-engulfing', 'evening-star', 'dark-cloud'].includes(data[i].pattern);

            // weighted scoring (aggressive weights)
            let bullishScore = 0;
            let bearishScore = 0;
            // supertrend becomes very decisive (weight 4)
            if (isSupertrendBullish)
                bullishScore += 4;
            if (isSupertrendBearish)
                bearishScore += 4;
            // EMA cross is still strong (weight 2)
            if (isEMACrossBullish)
                bullishScore += 2;
            if (isEMACrossBearish)
                bearishScore += 2;
            // secondary confirmations (weight 1)
            if (isMACDBullish)
                bullishScore += 1;
            if (isMACDBearish)
                bearishScore += 1;
            if (isRSIBullish)
                bullishScore += 1;
            if (isRSIBearish)
                bearishScore += 1;
            if (isAboveVWAP)
                bullishScore += 1;
            if (isBelowVWAP)
                bearishScore += 1;
            if (isVolumeSpiking) {
                bullishScore += 1;
                bearishScore += 1;
            }
            if (isBullishPattern)
                bullishScore += 1;
            if (isBearishPattern)
                bearishScore += 1;

            const atrRatio = data[i].atr && data[i].close ? (data[i].atr / data[i].close) : 0;

            //console.log(bullishScore,bearishScore);
            // core checks
            const bullishHasCore = isSupertrendBullish || isEMACrossBullish;
            const bearishHasCore = isSupertrendBearish || isEMACrossBearish;

            // aggressive core-override: if Supertrend is bullish and score >= 2 allow weak-buy;
            const aggressiveCoreOverrideBull = isSupertrendBullish && bullishScore >= 2 && atrRatio >= (MIN_ATR_RATIO * 0.5);
            const aggressiveCoreOverrideBear = isSupertrendBearish && bearishScore >= 2 && atrRatio >= (MIN_ATR_RATIO * 0.5);

            //console.log(bullishScore,MIN_WEIGHTED_SCORE,bullishHasCore,atrRatio,MIN_ATR_RATIO,aggressiveCoreOverrideBull);
            //console.log(bearishScore,MIN_WEIGHTED_SCORE,bearishHasCore,atrRatio,MIN_ATR_RATIO,aggressiveCoreOverrideBear);
            if ((bullishScore >= MIN_WEIGHTED_SCORE && bullishHasCore && atrRatio >= MIN_ATR_RATIO) || aggressiveCoreOverrideBull) {
                data[i].signal.type = bullishScore >= (MIN_WEIGHTED_SCORE + 2) ? 'strong-buy' : 'weak-buy';
                data[i].signal.source = `aggressive-weighted-${bullishScore}`;
                data[i].signal.price = data[i].high;
                data[i].signal.confidence = bullishScore;
            } else if ((bearishScore >= MIN_WEIGHTED_SCORE && bearishHasCore && atrRatio >= MIN_ATR_RATIO) || aggressiveCoreOverrideBear) {
                data[i].signal.type = bearishScore >= (MIN_WEIGHTED_SCORE + 2) ? 'strong-sell' : 'weak-sell';
                data[i].signal.source = `aggressive-weighted-${bearishScore}`;
                data[i].signal.price = data[i].low;
                data[i].signal.confidence = bearishScore;
            }

            // optional debug:
            // Add this at the end of detectSignals() to log all signals
            /*console.log('Detected signals:',
            this.data.filter(d => d.signal && d.signal.type)
            .map(d => ({
            time: new Date(d.time).toISOString(),
            type: d.signal.type,
            confidence: d.signal.confidence,
            price: d.signal.price
            })));*/
        }
    }

    updateChart() {
        if (!this.data || this.data.length === 0)
            return;

        // Choose only the visible candles (modify if you have zoom/pan)
        // Calculate dynamic y-axis scale
        const visibleData = this.data.slice(-100); // Last 100 candles
        const priceValues = visibleData.flatMap(d => [
                    d.high, d.low,
                    d.supertrendUpper || 0,
                    d.supertrendLower || 0
                ].filter(v => v !== null && v !== undefined));

        const minPrice = Math.min(...priceValues);
        const maxPrice = Math.max(...priceValues);
        const margin = (maxPrice - minPrice) * 0.1; // 10% margin
        const yMin = minPrice - margin;
        const yMax = maxPrice + margin;
        // Main candlestick series with pattern colors
        const patternColors = {
            // Bullish patterns
            'bullish-engulfing': '#00ff00',
            'hammer': '#90EE90',
            'morning-star': '#00ff00',
            'piercing-line': '#90EE90',
            'three-white-soldiers': '#00ff00',
            'dragonfly-doji': '#ADFF2F',
            'tweezer-bottom': '#90EE90',
            'inverted-hammer': '#90EE90',

            // Bearish patterns
            'bearish-engulfing': '#ff0000',
            'shooting-star': '#FFA07A',
            'evening-star': '#ff0000',
            'dark-cloud': '#FFA07A',
            'three-black-crows': '#ff0000',
            'gravestone-doji': '#FF6347',
            'tweezer-top': '#FFA07A',
            'hanging-man': '#FFA07A',

            // Neutral
            'doji': '#FFFF00'
        };

        // Main candlestick series with pattern colors
        const candlestickSeries = {
            name: this.pair,
            data: this.data.map(d => {
                // Default colors
                let fillColor = d.close >= d.open ? '#00c176' : '#ff3b30';
                let strokeColor = d.close >= d.open ? '#00c176' : '#ff3b30';

                // Apply pattern colors if exists
                if (d.pattern && patternColors[d.pattern]) {
                    fillColor = patternColors[d.pattern];
                    strokeColor = patternColors[d.pattern];

                    // For strong patterns, add a border effect
                    if (d.patternStrength === 2) {
                        strokeColor = '#FFFFFF';
                    }
                }

                return {
                    x: new Date(d.time),
                    y: [d.open, d.high, d.low, d.close],
                    fillColor: fillColor,
                    strokeColor: strokeColor
                };
            })
        };

        // Build series array based on enabled indicators
        const series = [candlestickSeries];

        // Only add Supertrend if enabled
        if (this.indicators.supertrend.enabled) {
            const supertrendUpperSeries = {
                name: 'Supertrend Upper',
                data: this.data.map(d => ({
                        x: new Date(d.time),
                        y: d.supertrendUpper || null
                    })),
                type: 'line',
                color: '#00c176',
                strokeWidth: 2
            };

            const supertrendLowerSeries = {
                name: 'Supertrend Lower',
                data: this.data.map(d => ({
                        x: new Date(d.time),
                        y: d.supertrendLower || null
                    })),
                type: 'line',
                color: '#ff3b30',
                strokeWidth: 2
            };

            series.push(supertrendUpperSeries, supertrendLowerSeries);
        }

        // Only add Support/Resistance if enabled
        if (this.indicators.supportResistance.enabled) {
            const supportSeries = {
                name: 'Support',
                data: this.data.map(d => ({
                        x: new Date(d.time),
                        y: d.support || null
                    })),
                type: 'line',
                color: '#4caf50',
                strokeDashArray: 5,
                strokeWidth: 1
            };

            const resistanceSeries = {
                name: 'Resistance',
                data: this.data.map(d => ({
                        x: new Date(d.time),
                        y: d.resistance || null
                    })),
                type: 'line',
                color: '#ff5722',
                strokeDashArray: 5,
                strokeWidth: 1
            };

            series.push(supportSeries);
            series.push(resistanceSeries);
        }

        // Signal markers - only show if indicators are enabled
        // In updateChart(), modify the signal markers section:
        // In updateChart() method, modify the signal markers section:
        const signalMarkers = this.data
            .filter(d => d.signal && d.signal.type)
            .map(d => {
                const isBuy = d.signal.type.includes('buy');
                // Position markers slightly above/below the candle
                const yPosition = isBuy ?
                    d.high * 1.002 : // Just above high for buys
                    d.low * 0.998; // Just below low for sells

                return {
                    x: new Date(d.time),
                    y: yPosition,
                    marker: {
                        size: 12,
                        fillColor: isBuy ? '#00c176' : '#ff3b30',
                        strokeColor: '#fff',
                        strokeWidth: 2,
                        radius: 6,
                        shape: isBuy ? 'triangle' : 'invertedTriangle',
                        cssClass: 'apexcharts-candlestick-signal'
                    },
                    label: {
                        text: `${d.signal.type.toUpperCase()}`,
                        style: {
                            color: '#fff',
                            background: isBuy ? '#00c176' : '#ff3b30',
                            fontSize: '12px',
                            padding: {
                                left: 8,
                                right: 8,
                                top: 4,
                                bottom: 4
                            }
                        },
                        offsetY: isBuy ? -25 : 25
                    }
                };
            });
        const currentPrice = this.data[this.data.length - 1].close;
        const priceLine = {
            id: 'current-price-line',
            y: currentPrice,
            strokeDashArray: 0,
            borderColor: '#3a7bd5',
            borderWidth: 1,
            label: {
                borderColor: '#3a7bd5',
                offsetY: 0,
                offsetX: 20, // Add this to push the label slightly right of the line
                style: {
                    color: '#fff',
                    background: '#3a7bd5'
                },
                text: `${currentPrice.toFixed(2)}`,
                position: 'right',
                textAnchor: 'start' // Ensures text aligns to the left of the label position
            }
        };

        // Update chart with all series and annotations
        this.chart.updateOptions({
            yaxis: {
                min: yMin,
                max: yMax,
                opposite: true, // <--- key line
                labels: {
                    formatter: function (val) {
                        return val != null ? val.toFixed(2) : 0.0; // Always 2 decimals
                    }
                }
            },
            series: series,
            annotations: {
                yaxis: [priceLine],
                points: [
                    ...signalMarkers,
                    ...(this.tradeMarkers || [])
                ],
                lines: this.tradeLines || []
            }
        }, false, true, true); // Note the last parameter is true to redraw

        // Update RSI and MACD charts if enabled
        if (this.indicators.rsi.enabled) {
            this.updateRSIChart();
        } else if (this.rsiChart) {
            this.rsiChart.destroy();
            this.rsiChart = null;
        }

        if (this.indicators.macd.enabled) {
            this.updateMACDChart();
        } else if (this.macdChart) {
            this.macdChart.destroy();
            this.macdChart = null;
        }
    }

    updateRSIChart() {
        const rsiSeries = {
            name: 'RSI',
            data: this.data.map(d => ({
                    x: new Date(d.time),
                    y: d.rsi || null
                })),
            type: 'line'
        };

        const rsiOptions = {
            series: [rsiSeries],
            chart: {
                height: 150,
                type: 'line',
                toolbar: {
                    show: false
                },
                animations: {
                    enabled: false
                },
                fontFamily: 'inherit'
            },
            stroke: {
                width: 2,
                colors: ['#3a7bd5']
            },
            xaxis: {
                type: 'datetime',
                labels: {
                    formatter: (value) => {
                        const date = new Date(value);
                        return this.formatTimeForTimeframe(date);
                    },
                    style: {
                        colors: '#a1a9bb',
                        fontSize: '12px'
                    }
                },
                axisBorder: {
                    show: true,
                    color: '#2a3241'
                },
                axisTicks: {
                    show: true,
                    color: '#2a3241'
                }
            },
            yaxis: {
                min: 0,
                max: 100,
                tickAmount: 5,
                labels: {
                    formatter: function (val) {
                        return Math.round(val);
                    },
                    style: {
                        colors: '#3a7bd5',
                        fontSize: '12px'
                    }
                },
                axisBorder: {
                    show: true,
                    color: '#3a7bd5'
                },
                axisTicks: {
                    show: true,
                    color: '#3a7bd5'
                }
            },
            grid: {
                borderColor: '#2a3241'
            },
            annotations: {
                yaxis: [{
                        y: this.indicators.rsi.overbought,
                        borderColor: '#ff5722',
                        strokeDashArray: 0,
                        opacity: 0.5
                    }, {
                        y: this.indicators.rsi.oversold,
                        borderColor: '#4caf50',
                        strokeDashArray: 0,
                        opacity: 0.5
                    }
                ]
            },
            tooltip: {
                enabled: true,
                custom: ({
                    series,
                    seriesIndex,
                    dataPointIndex,
                    w
                }) => {
                    // Fix: Get date from series data instead of categoryLabels
                    const dataPoint = w.config.series[seriesIndex].data[dataPointIndex];
                    const date = new Date(dataPoint.x);
                    const dateStr = this.formatTimeForTimeframe(date);

                    const rsiValue = dataPoint.y;
                    let status = '';

                    if (rsiValue >= this.indicators.rsi.overbought) {
                        status = '<div style="color:#ff5722;margin-top:5px">Overbought</div>';
                    } else if (rsiValue <= this.indicators.rsi.oversold) {
                        status = '<div style="color:#4caf50;margin-top:5px">Oversold</div>';
                    }

                    return `
                    <div class="tooltip-container">
                        <div class="tooltip-date">${dateStr}</div>
                        <div class="tooltip-data">
                            <div><span class="tooltip-label">RSI:</span> 
                            <span class="tooltip-value">${rsiValue ? rsiValue.toFixed(2) : 'N/A'}</span></div>
                            ${status}
                        </div>
                    </div>
                `;
                }
            }
        };

        if (!this.rsiChart) {
            this.rsiChart = new ApexCharts(document.querySelector("#rsi-chart"), rsiOptions);
            this.rsiChart.render();
        } else {
            this.rsiChart.updateOptions(rsiOptions);
        }
    }

    updateMACDChart() {
        const macdSeries = {
            name: 'MACD',
            data: this.data.map(d => ({
                    x: new Date(d.time),
                    y: d.macd || null
                })),
            type: 'line'
        };

        const signalSeries = {
            name: 'Signal',
            data: this.data.map(d => ({
                    x: new Date(d.time),
                    y: d.signalValue || null
                })),
            type: 'line'
        };

        const histogramSeries = {
            name: 'Histogram',
            data: this.data.map(d => ({
                    x: new Date(d.time),
                    y: d.histogram || null,
                    fillColor: d.histogram >= 0 ? '#00c176' : '#ff3b30'
                })),
            type: 'column'
        };

        // Calculate min/max for Y-axis with whole numbers
        const maxVal = Math.ceil(Math.max(
                    ...this.data.map(d => Math.abs(d.macd || 0)),
                    ...this.data.map(d => Math.abs(d.signalValue || 0))));
        const roundedMax = maxVal === 0 ? 1 : Math.ceil(maxVal);
        const yMin = -roundedMax;
        const yMax = roundedMax;
        const tickAmount = 4; // Shows 0, ±some value, ±max value

        const macdOptions = {
            series: [macdSeries, signalSeries, histogramSeries],
            chart: {
                height: 150,
                type: 'line',
                toolbar: {
                    show: false
                },
                animations: {
                    enabled: false
                },
                fontFamily: 'inherit'
            },
            stroke: {
                width: [2, 2, 0],
                colors: ['#3a7bd5', '#ff9800']
            },
            fill: {
                type: 'solid',
                opacity: 1
            },
            colors: ['#3a7bd5', '#ff9800', '#00c176'],
            xaxis: {
                type: 'datetime',
                labels: {
                    formatter: (value) => {
                        const date = new Date(value);
                        return this.formatTimeForTimeframe(date);
                    },
                    style: {
                        colors: '#a1a9bb',
                        fontSize: '12px'
                    }
                },
                axisBorder: {
                    show: true,
                    color: '#2a3241'
                },
                axisTicks: {
                    show: true,
                    color: '#2a3241'
                }
            },
            yaxis: {
                min: yMin,
                max: yMax,
                tickAmount: tickAmount,
                labels: {
                    formatter: function (val) {
                        // Show only whole numbers
                        return Number.isInteger(val) ? val : '';
                    },
                    style: {
                        colors: '#ff9800',
                        fontSize: '12px'
                    }
                },
                axisBorder: {
                    show: true,
                    color: '#ff9800'
                },
                axisTicks: {
                    show: true,
                    color: '#ff9800'
                }
            },
            grid: {
                borderColor: '#2a3241'
            },
            tooltip: {
                enabled: true,
                custom: ({
                    series,
                    seriesIndex,
                    dataPointIndex,
                    w
                }) => {
                    const dataPoint = w.config.series[0].data[dataPointIndex];
                    const date = new Date(dataPoint.x);
                    const dateStr = this.formatTimeForTimeframe(date);

                    const macdValue = series[0][dataPointIndex]?.toFixed(2) || 'N/A';
                    const signalValue = series[1][dataPointIndex]?.toFixed(2) || 'N/A';
                    const histogramValue = series[2][dataPointIndex]?.toFixed(2) || 'N/A';
                    const histColor = series[2][dataPointIndex] >= 0 ? '#00c176' : '#ff3b30';

                    return `
                    <div class="tooltip-container">
                        <div class="tooltip-date">${dateStr}</div>
                        <div class="tooltip-data">
                            <div><span class="tooltip-label">MACD:</span> 
                            <span class="tooltip-value">${macdValue}</span></div>
                            <div><span class="tooltip-label">Signal:</span> 
                            <span class="tooltip-value">${signalValue}</span></div>
                            <div><span class="tooltip-label">Histogram:</span> 
                            <span class="tooltip-value" style="color:${histColor}">${histogramValue}</span></div>
                        </div>
                    </div>
                `;
                }
            }
        };

        if (!this.macdChart) {
            this.macdChart = new ApexCharts(document.querySelector("#macd-chart"), macdOptions);
            this.macdChart.render();
        } else {
            this.macdChart.updateOptions(macdOptions);
        }
    }

    updateInfoPanel(candle) {
        // If no candle provided, use the latest candle
        const displayCandle = candle || this.data[this.data.length - 1];
        if (!displayCandle)
            return;

        const isUp = displayCandle.close > displayCandle.open;

        document.getElementById('info-open').textContent = displayCandle.open.toFixed(2);
        document.getElementById('info-high').textContent = displayCandle.high.toFixed(2);
        document.getElementById('info-low').textContent = displayCandle.low.toFixed(2);
        document.getElementById('info-close').textContent = displayCandle.close.toFixed(2);
        document.getElementById('info-volume').textContent = displayCandle.volume.toFixed(2);
        // NEW: VWAP, Volume MA, EMAs
        //document.getElementById('info-vwap').textContent = displayCandle.vwap?.toFixed(2) || 'N/A';
        //document.getElementById('info-volume-ma').textContent = displayCandle.volumeMA?.toFixed(2) || 'N/A';
        //document.getElementById('info-ema20').textContent = displayCandle.ema20?.toFixed(2) || 'N/A';
        //document.getElementById('info-ema50').textContent = displayCandle.ema50?.toFixed(2) || 'N/A';

        // Update indicator values
        if (this.indicators.supertrend.enabled) {
            document.getElementById('info-supertrend').textContent =
                displayCandle.supertrendDirection === 'up' ? 'Bullish' : 'Bearish';
            document.getElementById('info-supertrend').className =
                displayCandle.supertrendDirection === 'up' ? 'up' : 'down';
        }

        if (this.indicators.rsi.enabled) {
            document.getElementById('info-rsi').textContent = displayCandle.rsi ? displayCandle.rsi.toFixed(2) : 'N/A';
            document.getElementById('info-rsi').className =
                displayCandle.rsi > this.indicators.rsi.overbought ? 'overbought' :
                displayCandle.rsi < this.indicators.rsi.oversold ? 'oversold' : '';
        }

        if (this.indicators.macd.enabled) {
            document.getElementById('info-macd').textContent = displayCandle.macd ? displayCandle.macd.toFixed(2) : 'N/A';
            document.getElementById('info-signal').textContent = displayCandle.signalValue ? displayCandle.signalValue.toFixed(2) : 'N/A';
            document.getElementById('info-histogram').textContent = displayCandle.histogram ? displayCandle.histogram.toFixed(2) : 'N/A';

            // Set color for histogram
            const histogramElement = document.getElementById('info-histogram');
            histogramElement.className = '';
            if (displayCandle.histogram) {
                histogramElement.className = displayCandle.histogram >= 0 ? 'up' : 'down';
            }
        }

        if (this.indicators.supportResistance.enabled) {
            document.getElementById('info-support').textContent = displayCandle.support ? displayCandle.support.toFixed(2) : 'N/A';
            document.getElementById('info-resistance').textContent = displayCandle.resistance ? displayCandle.resistance.toFixed(2) : 'N/A';
        }

        // Update colors based on price direction
        const colorClass = isUp ? 'up' : 'down';
        ['open', 'high', 'low', 'close'].forEach(id => {
            const element = document.getElementById(`info-${id}`);
            element.classList.remove('up', 'down');
            element.classList.add(colorClass);
        });
    }

    async updateCurrentPrice() {
        try {
            // Fetch 24h ticker data from Binance
            const response = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${this.pair}`);
            const tickerData = await response.json();

            const currentPrice = parseFloat(tickerData.lastPrice);
            const priceChange = parseFloat(tickerData.priceChangePercent);

            document.getElementById('current-pair').innerHTML = `
				${this.pair.replace('USDT', '/USDT')} 
				<span class="current-price">$${currentPrice.toFixed(2)}</span>
				<span class="price-change ${priceChange >= 0 ? 'up' : 'down'}">
					${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%
				</span>
			`;
        } catch (error) {
            console.error("Failed to fetch 24h price change:", error);
        }
    }

    formatTimeForTimeframe(date) {
        switch (this.timeframe) {
        case '1d':
            return date.toLocaleDateString(navigator.language, {
                month: 'short',
                day: 'numeric'
            });
        case '4h':
        case '1h':
            return date.toLocaleTimeString(navigator.language, {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        default: // 1m, 5m, 15m
            return date.toLocaleTimeString(navigator.language, {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        }
    }

    // Notification system setup
    // Update these methods in your CandleChart class

    initNotifications() {
        // Remove existing container if it exists
        const existingContainer = document.getElementById('candle-notifications');
        if (existingContainer)
            existingContainer.remove();

        this.notificationContainer = document.createElement('div');
        this.notificationContainer.id = 'candle-notifications';
        this.notificationContainer.style.position = 'fixed';
        this.notificationContainer.style.top = '20px';
        this.notificationContainer.style.right = '20px';
        this.notificationContainer.style.zIndex = '10000'; // Higher z-index to ensure visibility
        this.notificationContainer.style.display = 'flex';
        this.notificationContainer.style.flexDirection = 'column';
        this.notificationContainer.style.gap = '10px';
        this.notificationContainer.style.maxWidth = '350px';
        document.body.appendChild(this.notificationContainer);
    }

    showNotification(pattern, candle) {
        if (!this.notificationContainer)
            this.initNotifications();

        const patternInfo = {
            'hammer': {
                title: 'Hammer Pattern Detected',
                message: 'Bullish reversal signal suggesting potential buying opportunity',
                color: '#4CAF50',
                icon: '🔨',
                action: 'Consider BUY'
            },
            'bullish-engulfing': {
                title: 'Bullish Engulfing',
                message: 'Strong bullish reversal pattern after a downtrend',
                color: '#2E7D32',
                icon: '📈',
                action: 'Strong BUY Signal'
            },
            'morning-star': {
                title: 'Morning Star',
                message: 'Reliable bullish reversal pattern after a downtrend',
                color: '#1B5E20',
                icon: '🌅',
                action: 'Strong BUY'
            },
            'shooting-star': {
                title: 'Shooting Star',
                message: 'Bearish reversal signal at the top of an uptrend',
                color: '#D32F2F',
                icon: '💫',
                action: 'Consider SELL'
            },
            'bearish-engulfing': {
                title: 'Bearish Engulfing',
                message: 'Strong bearish reversal pattern after an uptrend',
                color: '#B71C1C',
                icon: '📉',
                action: 'Strong SELL Signal'
            },
            'evening-star': {
                title: 'Evening Star',
                message: 'Reliable bearish reversal pattern after an uptrend',
                color: '#7F0000',
                icon: '🌇',
                action: 'Strong SELL'
            },
            'inverted-hammer': {
                title: 'Inverted Hammer',
                message: 'Bullish reversal signal after a downtrend',
                color: '#689F38',
                icon: '🔝',
                action: 'Potential BUY'
            },
            'hanging-man': {
                title: 'Hanging Man',
                message: 'Bearish reversal signal at the top of an uptrend',
                color: '#E53935',
                icon: '🪂',
                action: 'Potential SELL'
            }
        };

        const info = patternInfo[pattern] || {
            title: `${pattern} Pattern`,
            message: 'Significant candlestick pattern detected',
            color: '#FFC107',
            icon: '👀',
            action: 'Watch Closely'
        };

        const price = candle.close.toFixed(2);
        const time = new Date(candle.time).toLocaleTimeString();

        const notification = document.createElement('div');
        notification.className = 'candle-notification';
        notification.style.backgroundColor = '#1E1E1E';
        notification.style.color = 'white';
        notification.style.padding = '15px';
        notification.style.borderRadius = '8px';
        notification.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        notification.style.borderLeft = `4px solid ${info.color}`;
        notification.style.transform = 'translateX(120%)';
        notification.style.transition = 'transform 0.3s ease-out';
        notification.style.position = 'relative';
        notification.style.overflow = 'hidden';

        notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <div style="font-size: 24px; color: ${info.color}">${info.icon}</div>
            <div style="flex: 1;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <div style="font-weight: 600; font-size: 15px;">${info.title}</div>
                    <div style="font-weight: bold; font-size: 14px; color: ${info.color}">${info.action}</div>
                </div>
                <div style="font-size: 13px; opacity: 0.8; margin-bottom: 6px;">${info.message}</div>
                <div style="display: flex; justify-content: space-between; font-size: 12px;">
                    <div style="opacity: 0.7;">${this.pair} • ${price}</div>
                    <div style="opacity: 0.6;">${time}</div>
                </div>
            </div>
        </div>
        <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, ${info.color}, transparent);"></div>
    `;

        this.notificationContainer.prepend(notification);

        // Trigger the slide-in animation
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 10);

        // Auto-remove after 8 seconds
        setTimeout(() => {
            notification.style.transform = 'translateX(120%)';
            setTimeout(() => notification.remove(), 300);
        }, 15000);

        // Add click to dismiss
        notification.addEventListener('click', () => {
            notification.style.transform = 'translateX(120%)';
            setTimeout(() => notification.remove(), 300);
        });
    }

    // Update the CSS styles
    addNotificationStyles() {
        const style = document.createElement('style');
        style.textContent = `
        .candle-notification {
            cursor: pointer;
            transition: transform 0.3s ease-out, opacity 0.2s ease;
        }
        .candle-notification:hover {
            transform: translateX(0) scale(1.02) !important;
            box-shadow: 0 6px 16px rgba(0,0,0,0.4);
        }
    `;
        document.head.appendChild(style);
    }
}

// Initialize chart when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new CandleChart();
    const tabBtns = document.querySelectorAll('.tab-btn');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            // Remove active class from all buttons and content
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            // Add active class to clicked button and corresponding content
            this.classList.add('active');
            const tabId = this.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');
        });
    });

    const settingsBtn = document.getElementById('settings-btn');
    const popupClose = document.getElementById('popup-close');
    const settingsPopup = document.getElementById('settings-popup');
    const overlay = document.getElementById('settings-overlay');

    settingsBtn.addEventListener('click', function () {
        settingsPopup.classList.add('active');
        overlay.classList.add('active');
    });

    popupClose.addEventListener('click', function () {
        settingsPopup.classList.remove('active');
        overlay.classList.remove('active');
    });

    overlay.addEventListener('click', function () {
        settingsPopup.classList.remove('active');
        overlay.classList.remove('active');
    });

});




