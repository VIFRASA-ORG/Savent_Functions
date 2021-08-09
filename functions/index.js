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
	.onUpdate(async (change, context) => {
		const oldEvent = change.before.data();
		const newEvent = change.after.data();

		functions.logger.log("ClimbEventQueue","Executed now");

		//In case someone has left the event and there is someone in the queue
		if((newEvent.numeroPartecipanti < oldEvent.numeroPartecipanti || newEvent.numeroMassimoPartecipanti > oldEvent.numeroMassimoPartecipanti) && newEvent.numeroPartecipantiInCoda > 0){
			
			//We have find the first person in the queue
			const db = admin.firestore();

			//Find the maximum number of person that is possible to shift
			const maxNumOfShift = newEvent.numeroMassimoPartecipanti - newEvent.numeroPartecipanti;

			//Executing the query to find all the person that is possible to shift
			const firstPersonInQueue = await db.collection("Partecipazioni").where("idEvento","==",context.params.idEvento).where("accettazione","==",true).where("listaAttesa","==",true).orderBy("dataOra").limit(maxNumOfShift).get();

			functions.logger.log("ClimbEventQueue","Query executed");

			if(!firstPersonInQueue.empty){
				let partecipations = [];

				firstPersonInQueue.forEach(doc => partecipations.push(doc));
				functions.logger.log("ClimbEventQueue",partecipations.length);


				if(partecipations.length > 0){
					//Partecipation found

					partecipations.forEach(async partecipation => {
						functions.logger.log("ClimbEventQueue", partecipation);

						// Get a new write batch
						const batch = db.batch();

						//We have to update the listaAttesa flag of the partecipation
						batch.update(db.collection("Partecipazioni").doc(partecipation.id),{listaAttesa: false});

						//Update the number of partecipant of the event and the number of the people in queue
						batch.update(db.collection("Eventi").doc(context.params.idEvento),{numeroPartecipanti: admin.firestore.FieldValue.increment(1)});
						batch.update(db.collection("Eventi").doc(context.params.idEvento),{numeroPartecipantiInCoda: admin.firestore.FieldValue.increment(-1)});

						// Commit the batch
						await batch.commit();

						functions.logger.log("ClimbEventQueue", partecipation.idUtente);
						const part = partecipation.data()

						//Get the token of the user
	    				const token = await getNotificationToken(part.idUtente);

						if (token == null) {
						  	console.log('No token for the user: ', part.idUtente);
						} else {
							console.log('Token found for the user: ', part.idUtente);

							//Formatting the payload
							const payload = {
								token: token,
							    data: {
							        notificationType: "queueClimbed",
							        eventId: part.idEvento,
							        eventName: newEvent.nome,
							    }
							};

							sendNotification(payload);
						}

					});
				}
			}

		}
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

	    functions.logger.log("GroupCreated","Iterating among all the component of the group");
	    //Iterating among all the component of the group just created 
	    newGroup.idComponenti.forEach(async componentId => {
	    	if(componentId == idAdmin){
	    		return;
	    	}

	    	//Get the token of the user
	    	const token = await getNotificationToken(componentId);

			if (token == null) {
			  	console.log('No token for the user: ', componentId);
			} else {
				console.log('Token found for the user: ', componentId);
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

				sendNotification(payload);
			}
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

		newGroupComponent.forEach(async componentId => {
			if(!oldGroupComponent.includes(componentId)){
				console.log("Added a new user to the group: ", componentId);

				//download the user token
				const token = await getNotificationToken(componentId);

				if(token == null){
					console.log('No token for the user: ', componentId);
				}else{
					console.log('Token found for the user: ', componentId);
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

					sendNotification(payload);
				}

			}
		})
		console.log("End of execution!");
	});

/**
 * Trigger this function when a Event document is deleted.
 * Function called every time a Event is deleted.
 * This function send a notification to all the event partecipant
 * and delete all the event partecipation from the Collection "Partecipazioni".
 * 
 **/ 
exports.deleteEvent = functions.firestore.document('Eventi/{idEvento}')
	.onDelete(async (snap,context) => {

		console.log("deleteEvent", " Function started");
		const db = admin.firestore();
		const deletedEvent = snap.data();

		//Get all the partecipation associated to that event
		const snapshot = await db.collection("Partecipazioni").where("idEvento","==",context.params.idEvento).get();
		if(snapshot.empty){
			console.log("No partecipations associated to the event: ", context.params.idEvento);
			return;
		}

		console.log("deleteEvent", " Iterating among all the partecipations");

		//iterating among all the partecipation to send the notification to all user partecipating to the event
		snapshot.forEach(async doc => {
			partecipationId = doc.id;
			partecipation = doc.data();

			console.log("Partecipation: ", doc.id);

			//getting the token to send the notification
			const token = await getNotificationToken(partecipation.idUtente);

			if(token == null){
				console.log('No token for the user: ', partecipation.idUtente);
			}else{
				console.log('Token found for the user: ', partecipation.idUtente);
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

				sendNotification(payload);
			}

			console.log("deleteEvent: ", " Deleting the partecipation from the collection");

			//delete the partecipation
			const res = await db.collection('Partecipazioni').doc(partecipationId).delete();
			console.log(res)
		});

		console.log("deleteEvent: ", " End of execution");
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
	admin.messaging().send(payload).then((response) => {
	    // Response is a message ID string.
	    console.log('Successfully sent message:', response);
	    return {success: true};
	}).catch((error) => {
	    return {error: error.code};
	});
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














