const functions = require("firebase-functions");

// The Firebase Admin SDK to access Firestore.
const admin = require('firebase-admin');
admin.initializeApp();






/* Listens for a change into the event collection.
 * Function called every time an event is updated.
 * Let the user climb the queue and send the notification to the new partecipants.
 *
 **/
exports.ClimbEventQueue = functions.firestore.document('Eventi/{idEvento}')
	.onUpdate( (change, context) => {
		const oldEvent = change.before.data();
		const newEvent = change.after.data();

		console.log("ClimbEventQueue","Executed now");

		//In case someone has left the event and there is someone in the queue
		if((newEvent.numeroPartecipanti < oldEvent.numeroPartecipanti || newEvent.numeroMassimoPartecipanti > oldEvent.numeroMassimoPartecipanti) && newEvent.numeroPartecipantiInCoda > 0){
			
			//We have find the first person in the queue
			const db = admin.firestore();

			//Find the maximum number of person that is possible to shift
			const maxNumOfShift = newEvent.numeroMassimoPartecipanti - newEvent.numeroPartecipanti;

			partecipations = [];
			notificationTokensPromises = [];
			userId = [];

			//Executing the query to find all the person that is possible to shift
			return db.collection("Partecipazioni").where("idEvento","==",context.params.idEvento).where("accettazione","==",true).where("listaAttesa","==",true).orderBy("dataOra").limit(maxNumOfShift).get()
			.then(partecipationsPromises => {

				bachPromises = []

				if(!partecipationsPromises.empty){
					partecipationsPromises.forEach(doc => partecipations.push(doc));

					if(partecipations.length > 0){
						//Partecipation found

						//Iterating among all the partecipation found
						//All the partecipation to that have to climb the queue
						partecipations.forEach(partecipation => {
							console.log("ClimbEventQueue: analizing this partecipation", partecipation.id);

							//Executing a batch to update the number of partecipant of the event
							// and the number of partecipant into the queue.
							//It also set to false the flag "listaAttesa" of the partecipation.

							// Get a new write batch
							const batch = db.batch();

							//We have to update the listaAttesa flag of the partecipation
							batch.update(db.collection("Partecipazioni").doc(partecipation.id),{listaAttesa: false});

							//Update the number of partecipant of the event and the number of the people in queue
							batch.update(db.collection("Eventi").doc(context.params.idEvento),{numeroPartecipanti: admin.firestore.FieldValue.increment(1)});
							batch.update(db.collection("Eventi").doc(context.params.idEvento),{numeroPartecipantiInCoda: admin.firestore.FieldValue.increment(-1)});

							// Commit the batch and push to the promise list
							bachPromises.push(batch.commit());
						});
					}
				}

				//execute all the promise
				return Promise.all(bachPromises);
			})
			.then(successes => {
				//The flow comes here from the execution of all the update batch

				//Iterating among all the partecipation to downlaod all the notification token of the user
				partecipations.forEach(partecipation => {
					const part = partecipation.data();
					console.log("ClimbEventQueue", part.idUtente);

					//download the user token
					const token = getNotificationToken(part.idUtente);
					notificationTokensPromises.push(token);
					userId.push(part.idUtente);
				})

				//execute all the promises for the notification token
				return Promise.all(notificationTokensPromises);
			})
			.then(notificationTokens => {
				//The flow comes here from the execution of all the promes for the download of the notification token
				notificationPromises = [];

				//Iterating among all the notification token
				notificationTokens.forEach((token,index) =>{
					if(token == null){
						console.log('No token for the user: ', userId[index]);
					}else{
						console.log('Token found for the user: ', userId[index]);
						console.log('Token: ', token);

						//Formatting the payload
						const payload = {
							token: token,
						    data: {
						        notificationType: "queueClimbed",
						        eventId: partecipations[index].data().idEvento,
						        eventName: newEvent.nome,
						    }
						};

						//send the notification to the specified token
						const notifProm = sendNotification(payload);

						//adding the task to the promise list
						notificationPromises.push(notifProm);
					}
				});

				//execute all the promises for sending the notification
				return Promise.all(notificationPromises);
			})
			.then(notificationsId => {
				//The flow comes here from sending all the notification
				notificationsId.forEach(notificationId => {
					console.log('Successfully sent message:', notificationId);
				});
			})
			.catch(error => {
				//Catches all kind of error
				console.log("Error: ", error);
			});
		}else return 0;
	});






/**
 * Listens for a creation of a new group.
 * Function called every time a new group is created.
 * Send a notification to all the user into the group, except for the admin.
 * 
 **/
exports.GroupCreated = functions.firestore.document('Gruppi/{idGruppo}')
	.onCreate((snap, context) => {
		functions.logger.log("GroupCreated","Executed now");

		// Get an object representing the document
	    // e.g. {'name': 'Marie', 'age': 66}
	    const newGroup = snap.data();
	    const idAdmin = newGroup.idAmministratore;

	    notificationTokensPromises = []
	    usersId = [];

	    functions.logger.log("GroupCreated","Iterating among all the component of the group");
	    //Iterating among all the component of the group just created 
	    newGroup.idComponenti.forEach( componentId => {
	    	if(componentId == idAdmin){
	    		return;
	    	}

	    	//Get the token of the user
	    	const token = getNotificationToken(componentId);
	    	notificationTokensPromises.push(token)
	    	usersId.push(componentId);
	    });

	    return Promise.all(notificationTokensPromises)
	    .then(notificationTokens => {
			//The flow comes here from the execution of all the promises for the download of the notification token
			notificationPromises = [];

			//Iterating among all the notification token
			notificationTokens.forEach((token,index) =>{
				if(token == null){
					console.log('No token for the user: ', usersId[index]);
				}else{
					console.log('Token found for the user: ', usersId[index]);
					console.log('Token: ', token);

					//Formatting the payload
					const payload = {
						token: token,
					    data: {
					        notificationType: "addedToGroup",
					        groupId: String(context.params.idGruppo),
					        groupName: String(newGroup.nome),
					    }
					};

					//send the notification to the specified token
					const notifProm = sendNotification(payload);

					//adding the task to the promise list
					notificationPromises.push(notifProm);
				}
			});

			//execute all the promises for sending the notification
			return Promise.all(notificationPromises);
		})
		.then(notificationsId => {
			//The flow comes here from sending all the notification
			notificationsId.forEach(notificationId => {
				console.log('Successfully sent message:', notificationId);
			});
		})
		.catch(error => {
			//Catches all kind of error
			console.log("Error: ", error);
		});
    });







/**
 * Trigger this function when a Event document is deleted.
 * Function called every time a Event is deleted.
 * This function send a notification to all the event partecipant
 * and delete all the event partecipation from the Collection "Partecipazioni".
 * 
 **/ 
exports.deleteEvent = functions.firestore.document('Eventi/{idEvento}')
	.onDelete((snap,context) => {

		console.log("deleteEvent", " Function started");
		const db = admin.firestore();
		const deletedEvent = snap.data();

		notificationTokensPromises = [];
		usersId = [];

		partecipationsId = [];
		deletePartecipationPromises = [];

		//Get all the partecipation associated to that event
		return db.collection("Partecipazioni").where("idEvento","==",context.params.idEvento).get()
		.then(snapshot => {
			if(snapshot.empty){
				console.log("No partecipations associated to the event: ", context.params.idEvento);
			}else{
				console.log("deleteEvent", " Iterating among all the partecipations");

				snapshot.forEach(doc => {
					//Get the token of the user
					partecipationId = doc.id;
					partecipation = doc.data();

					console.log("Partecipation: ", doc.id);

			    	const token = getNotificationToken(partecipation.idUtente);
			    	notificationTokensPromises.push(token)
			    	usersId.push(partecipation.idUtente);
			    	partecipationsId.push(partecipationId);
				});
			}

			return Promise.all(notificationTokensPromises);
		})
		.then(notificationTokens => {
			//The flow comes here from the execution of all the promises for the download of the notification token
			notificationPromises = [];

			if(!notificationTokens.empty){
				//Iterating among all the notification token
				notificationTokens.forEach((token,index) =>{
					if(token == null){
						console.log('No token for the user: ', usersId[index]);
					}else{
						console.log('Token found for the user: ', usersId[index]);
						console.log('Token: ', token);

						//Formatting the payload
						const payload = {
							token: token,
						    data: {
						        notificationType: "eventDeleted",
						        eventId: context.params.idEvento,
						        eventName: deletedEvent.nome,
						    }
						};

						//send the notification to the specified token
						const notifProm = sendNotification(payload);

						//adding the task to the promise list
						notificationPromises.push(notifProm);
					}
				});
			}

			//execute all the promises for sending the notification
			return Promise.all(notificationPromises);
		})
		.then(notificationsId => {
			if(!notificationsId.empty){
				//The flow comes here from sending all the notification
				notificationsId.forEach(notificationId => {
					console.log('Successfully sent message:', notificationId);
				});

				if(!partecipationsId.empty){
					console.log("deleteEvent: ", " Deleting the partecipations from the collection");

					partecipationsId.forEach(partecipationId => {
						const res = db.collection('Partecipazioni').doc(partecipationId).delete();
						deletePartecipationPromises.push(res);
					});
				}
			}

			return Promise.all(deletePartecipationPromises);

		})
		.then(succes => {
			console.log("deleteEvent: ", " End of execution");
		})
		.catch(error => {
			//Catches all kind of error
			console.log("Error: ", error);
		});
	});






/**
 * Listens for a change into the Gruppi collection.
 * Function called every time a Group is updated.
 * This function check if a new user is added to group.
 * If it is true, send to him a notification.
 * 
 **/ 
exports.AddedToGroup = functions.firestore.document('Gruppi/{idGruppo}')
	.onUpdate((change, context) => {
		const newGroup = change.after.data();
		const oldGroup = change.before.data();

		//check if some user is been added
		oldGroupComponent = oldGroup.idComponenti;
		newGroupComponent = newGroup.idComponenti;

		notificationTokensPromises = [];
		userId = [];

		newGroupComponent.forEach( componentId => {
			if(!oldGroupComponent.includes(componentId)){
				console.log("Added a new user to the group: ", componentId);

				//download the user token
				const token = getNotificationToken(componentId);
				notificationTokensPromises.push(token);
				userId.push(componentId);
			}
		})

		return Promise.all(notificationTokensPromises).then(notificationTokens => {

			notificationPromises = [];

			notificationTokens.forEach((token,index) =>{
				if(token == null){
					console.log('No token for the user: ', userId[index]);
				}else{
					console.log('Token found for the user: ', userId[index]);
					console.log('Token: ', token);

					//Formatting the payload
					const payload = {
						token: token,
					    data: {
					        notificationType: "addedToGroup",
					        groupId: String(context.params.idGruppo),
					        groupName: String(newGroup.nome),
					    }
					};

					const notifProm = sendNotification(payload);
					notificationPromises.push(notifProm);
				}
			});

			return Promise.all(notificationPromises);
		})
		.then(notificationsId => {
			notificationsId.forEach(notificationId => {
				console.log('Successfully sent message:', notificationId);
			});
		})
		.catch(error => {
			console.log("Error: ", error);
		});
	});








/**
 * Function used to send a notification.
 * The payload has to be an object with inside at least the token of the user:
 * const payload = {
 * 		token: "jnbfwkne",
 * 		data: {
 * 			......
 * 		}
 * }
 * 
 **/
function sendNotification(payload){

	return admin.messaging().send(payload);

	/*
	admin.messaging().send(payload).then((response) => {
	    // Response is a message ID string.
	    console.log('Successfully sent message:', response);
	    return {success: true};
	}).catch((error) => {
	    return {error: error.code};
	});*/
}

/**
 * Return the notification token of the user given as parameter.
 * 
 **/ 
async function getNotificationToken(userId){
	//Get the token of the user
	const db = admin.firestore();
	const tokenRef = db.collection("MessagingToken").doc(userId);

	try{
		const doc = await tokenRef.get();
		if(!doc.exists){
			return null;
		}else{
			return doc.data().token;
		}
	}catch(error){
		return null;
	}
}














